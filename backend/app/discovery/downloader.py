"""Prowlarr → qBittorrent download dispatcher."""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import AsyncSessionLocal
from ..models.events import DownloadJob
from ..services import prowlarr, qbittorrent
from ..core.config import get_settings

settings = get_settings()
log = logging.getLogger(__name__)


async def queue_downloads(tracklist: list[dict], playlist_id: str | None = None) -> None:
    """Search Prowlarr and send to qBittorrent for each track in tracklist.

    Each track dict: {artist, title, navidrome_id?, ...}
    """
    async with AsyncSessionLocal() as db:
        for track in tracklist:
            artist = track.get("artist", "")
            title = track.get("title", "")
            if not artist or not title:
                continue

            results = await prowlarr.search(f"{artist} {title}")
            if not results:
                log.info("No Prowlarr results for '%s - %s'", artist, title)
                continue

            best = prowlarr.pick_best_result(results)
            if not best:
                continue

            magnet = best.get("magnetUrl") or best.get("downloadUrl")
            if not magnet:
                log.warning("No magnet/URL for '%s - %s'", artist, title)
                continue

            qb_hash = await qbittorrent.add_torrent(
                magnet,
                category="music",
                save_path=settings.DOWNLOADS_DIR,
            )
            if qb_hash:
                await db.execute(insert(DownloadJob).values(
                    id=str(uuid.uuid4()),
                    artist=artist,
                    title=title,
                    qb_hash=qb_hash,
                    status="queued",
                    playlist_id=playlist_id,
                    created_at=datetime.now(timezone.utc),
                ))
                log.info("Queued download: %s - %s (hash=%s)", artist, title, qb_hash)

        await db.commit()
