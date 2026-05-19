"""Central download pipeline: creates jobs and tries sources in priority order."""
import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import AsyncSessionLocal
from ..models.events import DownloadJob
from .sources import prowlarr_src, soulseek_src, youtube_src, archive_org_src

log = logging.getLogger(__name__)

# Sources tried in order — qobuz only if configured
_ALL_SOURCES = [prowlarr_src, soulseek_src, youtube_src, archive_org_src]

# Retry backoff in minutes per retry_count (index = retry_count after failure)
_BACKOFF_MINUTES = [15, 30, 60, 120, 240, 480, 720, 1440, 2880]
_MAX_RETRIES = len(_BACKOFF_MINUTES)


@asynccontextmanager
async def _db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


def _get_sources():
    """Return sources in priority order, inserting qobuz if configured."""
    from ..core.config import get_settings
    from .sources import qobuz_src
    settings = get_settings()
    sources = list(_ALL_SOURCES)
    if settings.QOBUZ_EMAIL and settings.QOBUZ_PASSWORD:
        sources.insert(0, qobuz_src)
    return sources


async def request_download(
    db: AsyncSession,
    item_type: str,
    artist: str,
    title: str = "",
    playlist_id: Optional[uuid.UUID] = None,
) -> DownloadJob:
    """Create a DownloadJob and kick off the pipeline immediately."""
    job = DownloadJob(
        item_type=item_type,
        artist=artist,
        title=title,
        status="queued",
        sources_tried=[],
        retry_count=0,
        playlist_id=playlist_id,
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)
    job_id = job.id
    await db.commit()
    asyncio.create_task(_run_pipeline(job_id))
    return job


async def retry_job(job_id: uuid.UUID) -> None:
    """Reset a failed/exhausted job and re-run immediately."""
    async with _db() as db:
        job = await db.get(DownloadJob, job_id)
        if not job:
            return
        job.status = "queued"
        job.sources_tried = []
        job.last_error = None
        job.retry_count = 0
        job.next_retry_at = None
    asyncio.create_task(_run_pipeline(job_id))


async def _run_pipeline(job_id: uuid.UUID) -> None:
    """Try each source in order; update job status throughout."""
    async with _db() as db:
        job = await db.get(DownloadJob, job_id)
        if not job or job.status not in ("queued",):
            return
        job.status = "downloading"

    sources = _get_sources()
    sources_tried = []

    for source in sources:
        try:
            async with _db() as db:
                job = await db.get(DownloadJob, job_id)
                ok = await source.download(job)
                if ok:
                    job.status = "completed"
                    job.source_used = source.NAME
                    job.sources_tried = sources_tried
                    job.completed_at = datetime.now(timezone.utc)
                    log.info("pipeline: %s - %s completed via %s", job.artist, job.title, source.NAME)
                    # Trigger rescan + analysis after non-torrent sources
                    if source.NAME not in ("prowlarr",):
                        asyncio.create_task(_post_download_hook())
                    return
        except Exception as e:
            err = str(e)
            sources_tried.append({"source": source.NAME, "error": err})
            log.info("pipeline: source %s failed for %s - %s: %s", source.NAME, job.artist if 'job' in dir() else "?", "", err)

    # All sources exhausted for this attempt
    async with _db() as db:
        job = await db.get(DownloadJob, job_id)
        if not job:
            return
        job.sources_tried = sources_tried
        job.last_error = sources_tried[-1]["error"] if sources_tried else "unknown"
        job.retry_count = (job.retry_count or 0) + 1

        if job.retry_count > _MAX_RETRIES:
            job.status = "exhausted"
            job.next_retry_at = None
            log.warning("pipeline: %s - %s exhausted after %d retries", job.artist, job.title, job.retry_count)
        else:
            delay = _BACKOFF_MINUTES[job.retry_count - 1]
            job.status = "failed"
            job.next_retry_at = datetime.now(timezone.utc) + timedelta(minutes=delay)
            log.info("pipeline: %s - %s failed, retry in %d min", job.artist, job.title, delay)


async def _post_download_hook() -> None:
    """Trigger Navidrome rescan + Essentia analysis after non-torrent downloads."""
    try:
        from .navidrome import trigger_scan
        from .essentia_svc import analyse_pending_songs
        await trigger_scan()
        await analyse_pending_songs()
    except Exception as e:
        log.error("post-download hook failed: %s", e)
