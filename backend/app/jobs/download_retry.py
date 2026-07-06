"""Retry failed downloads and daily quality-upgrade attempts."""
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from ..core.database import AsyncSessionLocal
from ..models.events import DownloadJob
from ..services.download_pipeline import _run_pipeline, _run_upgrade_pipeline

log = logging.getLogger(__name__)


async def retry_failed_downloads() -> None:
    """Re-queue failed jobs whose backoff window has elapsed."""
    try:
        now = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as db:
            # Cap per run + order by next_retry_at: a container restart resets
            # the whole backlog to failed at once; re-queuing all of them floods
            # the Semaphore(4) pipeline (soulseek's 600s ceiling = ~4 jobs/10min)
            # and starves the API. Drain steadily, oldest-due first.
            result = await db.execute(
                select(DownloadJob).where(
                    DownloadJob.status == "failed",
                    DownloadJob.next_retry_at <= now,
                )
                .order_by(DownloadJob.next_retry_at)
                .limit(25)
            )
            jobs = result.scalars().all()

            if not jobs:
                return

            for job in jobs:
                job.status = "queued"
                job.sources_tried = []
                job.candidates = []
                job.pipeline_log = []
                log.info("retry: re-queuing %s - %s (attempt %d)", job.artist, job.title, job.retry_count + 1)

            await db.commit()

        for job in jobs:
            from ..core.tasks import spawn
            spawn(_run_pipeline(job.id), name=f"pipeline-{job.id}")
    except Exception:
        log.exception("retry_failed_downloads: unhandled error")


async def upgrade_bad_quality_downloads() -> None:
    """Daily: attempt to find better-quality sources for bad_quality jobs."""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(DownloadJob).where(DownloadJob.review_status == "bad_quality")
            )
            jobs = result.scalars().all()

        if not jobs:
            return

        log.info("upgrade: found %d bad_quality jobs to retry", len(jobs))
        for job in jobs:
            try:
                await _run_upgrade_pipeline(job.id)
            except Exception:
                log.exception("upgrade: error upgrading job %s (%s - %s)", job.id, job.artist, job.title)
    except Exception:
        log.exception("upgrade_bad_quality_downloads: unhandled error")
