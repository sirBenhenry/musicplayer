"""Download management endpoints."""
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import require_auth
from ..core.database import get_db
from ..models.events import DownloadJob, UserNotification
from ..services.download_pipeline import request_download, retry_job, _run_pipeline

log = logging.getLogger(__name__)
router = APIRouter(tags=["downloads"], dependencies=[Depends(require_auth)])


class DownloadJobOut(BaseModel):
    id: uuid.UUID
    artist: str
    title: str
    item_type: str
    status: str
    source_used: Optional[str]
    sources_tried: list[dict]
    last_error: Optional[str]
    retry_count: int
    confidence_score: Optional[float]
    quality_score: Optional[float]
    review_status: Optional[str]
    file_path: Optional[str]
    auto_expires_at: Optional[datetime]
    mb_recording_id: Optional[str]
    model_config = {"from_attributes": True}


class RequestTrackBody(BaseModel):
    artist: str
    title: str
    mb_recording_id: Optional[str] = None
    mbid: Optional[str] = None  # legacy alias
    profile_id: Optional[str] = None


class RequestArtistBody(BaseModel):
    name: str
    mbid: str


class ReviewBody(BaseModel):
    action: str  # confirm|wrong_song|bad_quality


@router.get("/downloads", response_model=list[DownloadJobOut])
async def list_downloads(
    db: Annotated[AsyncSession, Depends(get_db)],
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=2000),
):
    q = select(DownloadJob).order_by(DownloadJob.created_at.desc())
    if status:
        statuses = [s.strip() for s in status.split(",")]
        q = q.where(DownloadJob.status.in_(statuses))
    q = q.offset((page - 1) * limit).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/downloads/failed", response_model=list[DownloadJobOut])
async def list_failed_downloads(db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(
        select(DownloadJob)
        .where(DownloadJob.status.in_(["failed", "exhausted"]))
        .order_by(DownloadJob.created_at.desc())
    )
    return result.scalars().all()


@router.get("/downloads/{job_id}", response_model=DownloadJobOut)
async def get_download(job_id: uuid.UUID, db: Annotated[AsyncSession, Depends(get_db)]):
    job = await db.get(DownloadJob, job_id)
    if not job:
        raise HTTPException(404, "Download job not found")
    return job


@router.get("/downloads/{job_id}/pipeline")
async def get_pipeline_log(job_id: uuid.UUID, db: Annotated[AsyncSession, Depends(get_db)]):
    """Full pipeline log + all candidates with scores for a job."""
    job = await db.get(DownloadJob, job_id)
    if not job:
        raise HTTPException(404, "Download job not found")
    return {
        "id": str(job.id),
        "artist": job.artist,
        "title": job.title,
        "status": job.status,
        "review_status": job.review_status,
        "confidence_score": job.confidence_score,
        "quality_score": job.quality_score,
        "file_path": job.file_path,
        "pipeline_log": job.pipeline_log or [],
        "candidates": job.candidates or [],
        "selected_candidate": job.selected_candidate,
        "mb_recording_id": job.mb_recording_id,
    }


@router.post("/downloads/{job_id}/review", status_code=200)
async def review_download(
    job_id: uuid.UUID,
    body: ReviewBody,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Handle user review action: confirm | wrong_song | bad_quality."""
    import asyncio
    if body.action not in ("confirm", "wrong_song", "bad_quality"):
        raise HTTPException(422, "action must be confirm|wrong_song|bad_quality")

    job = await db.get(DownloadJob, job_id)
    if not job:
        raise HTTPException(404, "Download job not found")

    # Dismiss linked notification
    notif_result = await db.execute(
        select(UserNotification)
        .where(UserNotification.download_job_id == job_id, UserNotification.dismissed == False)
    )
    for notif in notif_result.scalars().all():
        notif.dismissed = True
        notif.action_taken = body.action
        notif.dismissed_at = datetime.now(timezone.utc)

    if body.action == "confirm":
        job.review_status = "confirmed"

    elif body.action == "wrong_song":
        # Delete the file, requeue pipeline
        if job.file_path and os.path.exists(job.file_path):
            try:
                os.remove(job.file_path)
                log.info("review: deleted %s (wrong song)", job.file_path)
            except OSError as e:
                log.error("review: could not delete file %s: %s", job.file_path, e)
                # Continue re-queueing regardless
        job.status = "queued"
        job.review_status = None
        job.file_path = None
        job.sources_tried = []
        job.candidates = []
        job.pipeline_log = []
        job.selected_candidate = None
        job.confidence_score = None
        job.quality_score = None
        job.last_error = None
        job.retry_count = 0
        job.next_retry_at = None
        job.completed_at = None
        job.auto_expires_at = None
        await db.commit()
        asyncio.create_task(_run_pipeline(job_id))
        return {"status": "requeued", "message": "File deleted and pipeline restarted"}

    elif body.action == "bad_quality":
        job.review_status = "bad_quality"

    await db.commit()
    return {"status": "ok", "action": body.action}


@router.post("/downloads/track", status_code=202, response_model=DownloadJobOut)
async def download_track_v2(
    body: RequestTrackBody,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    mb_id = body.mb_recording_id or body.mbid
    profile_uuid = uuid.UUID(body.profile_id) if body.profile_id else None
    job = await request_download(
        db, item_type="track", artist=body.artist, title=body.title,
        mb_recording_id=mb_id, profile_id=profile_uuid,
    )
    return job


@router.post("/downloads/artist", status_code=202)
async def download_artist(
    body: RequestArtistBody,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    from ..services import musicbrainz
    releases = await musicbrainz.get_release_groups(body.mbid)
    if not releases:
        raise HTTPException(422, f"No releases found on MusicBrainz for {body.name}")
    jobs = []
    for release in releases:
        title = release.get("title", "").strip()
        if not title:
            continue
        job = await request_download(db, item_type="album", artist=body.name, title=title,
                                     mb_artist_id=body.mbid)
        jobs.append({"id": str(job.id), "title": title})
    return {"status": "queued", "count": len(jobs), "jobs": jobs}


@router.post("/downloads/{job_id}/retry", status_code=202)
async def retry_download(
    job_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    job = await db.get(DownloadJob, job_id)
    if not job:
        raise HTTPException(404, "Download job not found")
    await retry_job(job_id)
    return {"status": "requeued"}


@router.post("/downloads/{job_id}/cancel", status_code=200)
async def cancel_download(
    job_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    job = await db.get(DownloadJob, job_id)
    if not job:
        raise HTTPException(404, "Download job not found")
    if job.status not in ("queued", "downloading"):
        raise HTTPException(409, "Can only cancel queued or downloading jobs")
    qb_hash = job.qb_hash
    job.status = "failed"
    job.last_error = "Cancelled by user"
    job.qb_hash = None
    await db.commit()
    if qb_hash:
        try:
            from ..services.qbittorrent import delete_torrent
            await delete_torrent(qb_hash, delete_files=True)
        except Exception as e:
            log.warning("cancel: could not delete torrent %s: %s", qb_hash[:8], e)
    return {"status": "cancelled"}


@router.delete("/downloads/{job_id}", status_code=204)
async def delete_download(
    job_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    job = await db.get(DownloadJob, job_id)
    if not job:
        raise HTTPException(404, "Download job not found")
    if job.status not in ("completed", "exhausted", "failed"):
        raise HTTPException(409, "Can only delete completed or failed jobs")
    await db.delete(job)
