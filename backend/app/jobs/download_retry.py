"""Retry failed downloads whose backoff window has elapsed."""
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from ..core.database import AsyncSessionLocal
from ..models.events import DownloadJob
from ..services.download_pipeline import _run_pipeline

log = logging.getLogger(__name__)


async def retry_failed_downloads() -> None:
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(DownloadJob).where(
                DownloadJob.status == "failed",
                DownloadJob.next_retry_at <= now,
            )
        )
        jobs = result.scalars().all()

        if not jobs:
            return

        for job in jobs:
            job.status = "queued"
            job.sources_tried = []
            log.info("retry: re-queuing %s - %s (attempt %d)", job.artist, job.title, job.retry_count + 1)

        await db.commit()

    for job in jobs:
        asyncio.create_task(_run_pipeline(job.id))
