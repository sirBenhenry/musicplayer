"""Queue discovery playlist tracks for download via the full pipeline.

Resolves each track to a MusicBrainz recording ID before queuing so the
pipeline has an exact identity anchor rather than a fuzzy artist+title guess.
"""
import asyncio
import logging
import uuid as _uuid

from ..core.database import AsyncSessionLocal
from ..services.download_pipeline import request_download
from ..services.mb_resolver import resolve_recording

log = logging.getLogger(__name__)

_MB_RATE_DELAY = 1.1  # seconds between MB API calls (rate limit: 1 req/sec)


async def queue_downloads(tracklist: list[dict], playlist_id: str | None = None) -> None:
    """Queue each track through the full multi-source download pipeline.

    For each track that has no mb_recording_id, queries MusicBrainz first to
    resolve a confident recording ID (score ≥ 80).  Tracks that don't resolve
    still get queued — the pipeline falls back to fuzzy MB search internally.

    Skips tracks already in library (dedup handled by request_download).
    playlist_id here is a daily_playlist FK — passed as playlist_id kwarg.
    """
    pl_id = _uuid.UUID(playlist_id) if playlist_id else None
    first_mb_call = True

    async with AsyncSessionLocal() as db:
        for track in tracklist:
            artist = (track.get("artist") or "").strip()
            title = (track.get("title") or "").strip()
            if not artist or not title:
                continue

            # Resolve to MB recording ID for exact identity matching in scoring.
            # Tracks that already carry an mb_recording_id (e.g. from MCP or import)
            # skip the lookup entirely.
            mb_id: str | None = track.get("mb_recording_id") or None
            if not mb_id:
                if not first_mb_call:
                    await asyncio.sleep(_MB_RATE_DELAY)
                mb_id = await resolve_recording(artist, title)
                first_mb_call = False

            try:
                await request_download(
                    db, "track", artist, title,
                    mb_recording_id=mb_id,
                    playlist_id=pl_id,
                )
            except Exception as exc:
                log.error("queue_downloads: failed to queue '%s - %s': %s", artist, title, exc)

        await db.commit()
