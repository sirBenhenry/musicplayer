"""Download management endpoints."""
import logging
import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import require_auth
from ..core.database import get_db
from ..models.events import DownloadJob
from ..services.download_pipeline import request_download, retry_job

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
    model_config = {"from_attributes": True}


class RequestTrackBody(BaseModel):
    artist: str
    title: str
    mbid: Optional[str] = None


class RequestArtistBody(BaseModel):
    name: str
    mbid: str


@router.get("/downloads", response_model=list[DownloadJobOut])
async def list_downloads(
    db: Annotated[AsyncSession, Depends(get_db)],
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
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


@router.post("/downloads/track", status_code=202, response_model=DownloadJobOut)
async def download_track(
    body: RequestTrackBody,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    job = await request_download(db, item_type="track", artist=body.artist, title=body.title)
    return job


@router.post("/downloads/artist", status_code=202)
async def download_artist(
    body: RequestArtistBody,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Queue download of all releases for an artist via MusicBrainz → pipeline."""
    from ..services import musicbrainz

    releases = await musicbrainz.get_release_groups(body.mbid)
    if not releases:
        raise HTTPException(422, f"No releases found on MusicBrainz for {body.name}")

    jobs = []
    for release in releases:
        title = release.get("title", "").strip()
        if not title:
            continue
        job = await request_download(db, item_type="album", artist=body.name, title=title)
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
