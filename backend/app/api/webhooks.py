"""Inbound webhooks from Lidarr."""
import logging

from fastapi import APIRouter, Request

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
log = logging.getLogger(__name__)


@router.post("/lidarr")
async def lidarr_webhook(request: Request):
    body = await request.json()
    event_type = body.get("eventType")
    log.info("Lidarr webhook: %s", event_type)

    if event_type == "Download":
        artist = body.get("artist", {})
        artist_name = artist.get("name", "")
        log.info("Lidarr downloaded new release for artist: %s", artist_name)

        # Trigger async tasks — don't await (fire and forget)
        import asyncio
        from ..jobs.library_sync import run_library_sync
        from ..services.essentia_svc import analyse_pending_songs
        from ..core.database import AsyncSessionLocal
        from ..models.library import Artist as ArtistModel
        from sqlalchemy import select

        async def _post_download():
            await run_library_sync()
            await analyse_pending_songs()
            # Flag new release on artist in DB
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(ArtistModel).where(ArtistModel.name == artist_name)
                )
                a = result.scalar_one_or_none()
                if a:
                    from datetime import datetime, timezone
                    a.new_release_flagged_at = datetime.now(timezone.utc)
                    await db.commit()

        asyncio.create_task(_post_download())

    return {"ok": True}
