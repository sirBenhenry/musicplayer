"""
Cover art fetch job — daily scan + 4-hourly fast retry.

Daily: scan all songs with has_cover=False not tried in 20h.
Fast retry: songs with 1–5 failed attempts, retried every 4h.
After 5 failures the song falls back to daily cadence only.

Note: Song.file_path is Navidrome's virtual tag-based path, NOT a real
filesystem path. Real paths come from DownloadJob.file_path (absolute).
We match Song → DownloadJob by lower(artist)+lower(title).
"""
import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

log = logging.getLogger(__name__)

_RETRY_INTERVAL_H = 4
_MAX_FAST_RETRIES = 5


async def _resolve_file_path(song, db) -> tuple[str | None, str | None, str | None]:
    """
    Return (abs_path, mb_release_id, mb_recording_id) for a song.
    1. Look up DownloadJob by lower(artist+title) — use file_path if it exists.
    2. If file_path missing from disk, try find-by-basename under MUSIC_DIR.
    """
    from ..models.events import DownloadJob
    from ..core.config import get_settings

    artist = song.display_artist or (song.artist.name if song.artist else "") or ""
    title = song.title or ""
    mb_release_id = None
    mb_recording_id = None
    job_path = None

    try:
        jq = await db.execute(
            select(DownloadJob)
            .where(
                DownloadJob.status == "completed",
                DownloadJob.file_path.isnot(None),
                func.lower(DownloadJob.artist) == artist.lower(),
                func.lower(DownloadJob.title) == title.lower(),
            )
            .limit(1)
        )
        job = jq.scalar_one_or_none()
        if job and job.file_path:
            mb_release_id = job.selected_candidate.get("mb_release_id") if job.selected_candidate else None
            mb_recording_id = job.mb_recording_id or None
            job_path = job.file_path
    except Exception as e:
        log.debug("cover_art_job: job lookup failed for '%s - %s': %s", artist, title, e)

    # Exact path exists — done
    if job_path and os.path.exists(job_path):
        return job_path, mb_release_id, mb_recording_id

    # Fallback: search filesystem by basename of job_path (file moved to torrent subfolder)
    if job_path:
        basename = os.path.basename(job_path)
        music_dir = get_settings().MUSIC_DIR
        for root, _dirs, files in os.walk(music_dir):
            if basename in files:
                found = os.path.join(root, basename)
                log.debug("cover_art_job: found '%s' at %s via walk", basename, found)
                return found, mb_release_id, mb_recording_id

    # Final fallback: use Song.file_path (Navidrome-relative) + MUSIC_DIR
    if song.file_path:
        settings = get_settings()
        abs_path = os.path.join(settings.MUSIC_DIR, song.file_path)
        if os.path.exists(abs_path):
            log.debug("cover_art_job: resolved '%s - %s' via Song.file_path", artist, title)
            return abs_path, None, None

    return None, None, None


async def _navidrome_has_cover(navidrome_id: str) -> bool:
    """Return True if Navidrome serves an image for this track ID."""
    try:
        import httpx
        from ..core.config import get_settings
        s = get_settings()
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(
                f"{s.NAVIDROME_URL}/rest/getCoverArt",
                params={"id": navidrome_id, "u": s.NAVIDROME_USER, "p": s.NAVIDROME_PASS,
                        "v": "1.16.0", "c": "musicapp", "f": "json", "size": "64"},
            )
            return r.status_code == 200 and r.headers.get("content-type", "").startswith("image/")
    except Exception:
        return False


async def _process_songs(songs: list, db) -> int:
    """Attempt cover embed for each song. Returns count successfully embedded."""
    from ..services.download_pipeline import _fetch_and_embed_cover

    embedded = 0

    for song in songs:
        artist = song.display_artist or (song.artist.name if song.artist else "") or ""
        album = song.album.title if song.album else None

        abs_path, mb_release_id, mb_recording_id = await _resolve_file_path(song, db)

        if not abs_path:
            # File not found on disk — check if Navidrome already has a cover
            if song.navidrome_id and await _navidrome_has_cover(song.navidrome_id):
                song.has_cover = True
                song.cover_fetch_attempts = 0
                song.cover_last_tried_at = datetime.now(timezone.utc)
                embedded += 1
                log.info("cover_art_job: '%s - %s' has cover in Navidrome", artist, song.title)
            else:
                _bump(song)
                log.debug("cover_art_job: no file or Navidrome cover for '%s - %s'", artist, song.title)
            continue

        # File may have gained cover art externally since last check
        if _file_has_cover(abs_path):
            song.has_cover = True
            song.cover_fetch_attempts = 0
            song.cover_last_tried_at = datetime.now(timezone.utc)
            embedded += 1
            log.info("cover_art_job: '%s' already has cover in tags", song.title)
            continue

        try:
            ok = await _fetch_and_embed_cover(abs_path, artist, song.title, album, mb_release_id, mb_recording_id)
        except Exception as e:
            log.warning("cover_art_job: exception for '%s': %s", song.title, e)
            ok = False

        song.cover_last_tried_at = datetime.now(timezone.utc)
        if ok:
            song.has_cover = True
            song.cover_fetch_attempts = 0
            embedded += 1
            log.info("cover_art_job: embedded cover for '%s - %s'", artist, song.title)
        else:
            song.cover_fetch_attempts = (song.cover_fetch_attempts or 0) + 1
            log.debug("cover_art_job: no cover found for '%s - %s' (attempt %d)",
                      artist, song.title, song.cover_fetch_attempts)

    return embedded


def _file_has_cover(path: str) -> bool:
    try:
        import mutagen
        raw = mutagen.File(path)
        if not raw:
            return False
        if hasattr(raw.tags, "getall"):
            return bool(raw.tags and raw.tags.getall("APIC"))
        return bool(raw.get("covr") or raw.get("metadata_block_picture") or raw.get("METADATA_BLOCK_PICTURE"))
    except Exception:
        return False


def _bump(song) -> None:
    song.cover_last_tried_at = datetime.now(timezone.utc)
    song.cover_fetch_attempts = (song.cover_fetch_attempts or 0) + 1


async def scan_missing_covers() -> None:
    """Daily: all songs with has_cover=False not tried in 20h."""
    from ..core.database import AsyncSessionLocal
    from ..models.library import Song

    log.info("cover_art_job: daily scan starting")
    async with AsyncSessionLocal() as db:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=20)
        result = await db.execute(
            select(Song)
            .where(
                Song.has_cover == False,  # noqa: E712
                or_(
                    Song.cover_last_tried_at.is_(None),
                    Song.cover_last_tried_at < cutoff,
                ),
            )
            .options(selectinload(Song.artist), selectinload(Song.album))
        )
        songs = result.scalars().all()
        log.info("cover_art_job: %d songs without cover", len(songs))
        if not songs:
            return

        n = await _process_songs(songs, db)
        await db.commit()
        log.info("cover_art_job: daily scan done — embedded %d / %d", n, len(songs))

        if n > 0:
            from ..services.navidrome import trigger_scan
            await trigger_scan()


async def retry_missing_covers() -> None:
    """Every 4h: retry songs with 1–5 failed attempts."""
    from ..core.database import AsyncSessionLocal
    from ..models.library import Song

    async with AsyncSessionLocal() as db:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=_RETRY_INTERVAL_H)
        result = await db.execute(
            select(Song)
            .where(
                Song.has_cover == False,  # noqa: E712
                Song.cover_fetch_attempts > 0,
                Song.cover_fetch_attempts <= _MAX_FAST_RETRIES,
                Song.cover_last_tried_at < cutoff,
            )
            .options(selectinload(Song.artist), selectinload(Song.album))
        )
        songs = result.scalars().all()
        if not songs:
            return

        log.info("cover_art_job: fast-retry queue — %d songs", len(songs))
        n = await _process_songs(songs, db)
        await db.commit()
        log.info("cover_art_job: fast-retry done — embedded %d / %d", n, len(songs))

        if n > 0:
            from ..services.navidrome import trigger_scan
            await trigger_scan()
