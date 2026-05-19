"""APScheduler job: poll qBittorrent every 2 min for completed music downloads."""
import logging
from datetime import datetime, timezone

from sqlalchemy import select, update

from ..core.database import AsyncSessionLocal
from ..models.events import DownloadJob
from ..services import qbittorrent
from ..services.essentia_svc import analyse_pending_songs
from ..services.navidrome import trigger_scan

log = logging.getLogger(__name__)


async def poll_completed_downloads() -> None:
    completed = await qbittorrent.get_torrents(category="music", filter="completed")
    if not completed:
        return

    completed_hashes = {t["hash"] for t in completed}

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(DownloadJob).where(
                DownloadJob.status.in_(["queued", "downloading"]),
                DownloadJob.qb_hash.in_(completed_hashes),
            )
        )
        jobs = result.scalars().all()

        if not jobs:
            return

        for job in jobs:
            await db.execute(
                update(DownloadJob)
                .where(DownloadJob.id == job.id)
                .values(status="completed", completed_at=datetime.now(timezone.utc))
            )
            log.info("Download completed: %s - %s", job.artist, job.title)

        await db.commit()

    # New files landed — rescan Navidrome, then trigger Essentia
    await trigger_scan()
    await analyse_pending_songs()
