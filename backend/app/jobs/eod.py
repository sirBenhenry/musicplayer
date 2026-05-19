"""End-of-day batch: permanently delete songs marked for deletion."""
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import select

from ..core.database import AsyncSessionLocal
from ..models.events import PendingDeletion
from ..models.library import Song
from ..services.navidrome import trigger_scan

log = logging.getLogger(__name__)


async def run_eod_batch() -> dict:
    log.info("EOD batch started")
    deleted = 0
    errors = 0

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PendingDeletion).where(PendingDeletion.rescued == False)  # noqa: E712
        )
        pending = result.scalars().all()

        song_ids_deleted = []
        for pd in pending:
            song = await db.get(Song, pd.song_id)
            if not song:
                await db.delete(pd)
                continue

            # Delete file from filesystem
            if song.file_path and os.path.exists(song.file_path):
                try:
                    os.remove(song.file_path)
                    deleted += 1
                except OSError as e:
                    log.error("Failed to delete %s: %s", song.file_path, e)
                    errors += 1
                    continue
            else:
                deleted += 1  # File already gone or path unknown

            song_ids_deleted.append(song.id)
            await db.delete(pd)
            await db.delete(song)

        await db.commit()

    # Ask Navidrome to rescan so deleted songs disappear from its index
    if deleted > 0:
        try:
            await trigger_scan()
        except Exception as e:
            log.warning("Navidrome rescan failed: %s", e)

    log.info("EOD batch complete: deleted=%d errors=%d", deleted, errors)
    return {"deleted": deleted, "errors": errors}
