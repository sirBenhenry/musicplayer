"""
Playlist song health jobs:
- Every 30 min: force-retry failed/exhausted download jobs for active daily playlist songs
- At 05:30:  morning readiness — reset stale downloads, trigger LLM alternatives
- At 06:00:  remove still-unresolvable songs (with LLM alternative attempt first)

LLM fallback: when a song is exhausted, ask the LLM for an alternative.
Tracks up to 3 LLM attempts per original title (via pipeline_log marker).
Gives up after 3 failures → creates "failed_to_fill" notification.
"""
import asyncio
import logging
import uuid as _uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from ..core.database import AsyncSessionLocal
from ..models.discovery import DailyPlaylist
from ..models.events import DownloadJob, UserNotification
from ..models.library import Artist, Song

log = logging.getLogger(__name__)

_LLM_ALT_MAX = 3        # max LLM alternative attempts per original song
_STALE_HOURS = 3        # downloading jobs older than this are considered stale


async def retry_playlist_songs() -> None:
    """Force-retry failed/exhausted jobs for songs in active daily playlists."""
    from ..services.download_pipeline import request_download, _run_pipeline

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(DailyPlaylist).where(DailyPlaylist.consumed == False)  # noqa: E712
        )
        playlists = result.scalars().all()

        reset_job_ids: list[_uuid.UUID] = []

        for pl in playlists:
            songs_payload = pl.songs or []
            for entry in songs_payload:
                if entry.get("_genre") or entry.get("_artist_of_day"):
                    continue
                artist = (entry.get("artist") or "").strip()
                title = (entry.get("title") or "").strip()
                if not artist or not title:
                    continue

                job_result = await db.execute(
                    select(DownloadJob).where(
                        func.lower(DownloadJob.artist) == artist.lower(),
                        func.lower(DownloadJob.title) == title.lower(),
                    ).order_by(DownloadJob.created_at.desc()).limit(1)
                )
                job = job_result.scalar_one_or_none()

                if job is None:
                    try:
                        new_job = await request_download(
                            db, "track", artist, title,
                            playlist_id=_uuid.UUID(str(pl.id)),
                        )
                        reset_job_ids.append(new_job.id)
                        log.info("playlist_health: created missing job for '%s - %s'", artist, title)
                    except Exception as e:
                        log.warning("playlist_health: failed to create job for '%s - %s': %s", artist, title, e)
                elif job.status in ("failed", "exhausted"):
                    job.status = "failed"
                    job.next_retry_at = datetime.now(timezone.utc) - timedelta(minutes=1)
                    job.sources_tried = []
                    job.candidates = []
                    job.pipeline_log = []
                    reset_job_ids.append(job.id)
                    log.info("playlist_health: reset %s job for '%s - %s'", job.status, artist, title)

        await db.commit()

    for job_id in reset_job_ids:
        asyncio.create_task(_run_pipeline(job_id))

    if reset_job_ids:
        log.info("playlist_health: kicked off %d retries", len(reset_job_ids))


async def morning_playlist_readiness() -> None:
    """05:30 job: ensure playlist songs are downloadable before the user wakes up.

    1. Reset stale 'downloading' jobs (>3h, no file) so 15-min retry picks them up.
    2. Trigger LLM alternative for 'exhausted' songs that have no resolved file.
    """
    log.info("morning_playlist_readiness: starting")
    stale_cutoff = datetime.now(timezone.utc) - timedelta(hours=_STALE_HOURS)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(DailyPlaylist).where(DailyPlaylist.consumed == False)  # noqa: E712
        )
        playlists = result.scalars().all()

        for pl in playlists:
            for entry in (pl.songs or []):
                if entry.get("_genre") or entry.get("_artist_of_day"):
                    continue
                artist = (entry.get("artist") or "").strip()
                title = (entry.get("title") or "").strip()
                if not artist or not title:
                    continue

                job_result = await db.execute(
                    select(DownloadJob).where(
                        func.lower(DownloadJob.artist) == artist.lower(),
                        func.lower(DownloadJob.title) == title.lower(),
                    ).order_by(DownloadJob.created_at.desc()).limit(1)
                )
                job = job_result.scalar_one_or_none()
                if not job:
                    continue

                if job.status == "downloading":
                    # Check stale: pipeline_log[0].ts > stale_cutoff means recently started
                    log_ts = _first_log_ts(job)
                    if log_ts and log_ts < stale_cutoff:
                        job.status = "failed"
                        job.next_retry_at = datetime.now(timezone.utc) - timedelta(minutes=1)
                        job.pipeline_log = []
                        log.info("morning_readiness: reset stale 'downloading' job for '%s - %s'", artist, title)

                elif job.status == "exhausted":
                    # Try LLM alternative immediately rather than waiting for 6am cleanup
                    await _try_llm_alternative(db, pl, entry, artist, title)

        await db.commit()

    log.info("morning_playlist_readiness: done")


async def cleanup_unresolvable_playlist_songs() -> None:
    from sqlalchemy.orm import flag_modified
    """06:00: remove songs from playlist JSONB that still can't be found.

    Tries LLM alternative before removing. After _LLM_ALT_MAX attempts, gives up
    and creates a 'failed_to_fill' notification.
    """
    from ..core.config import get_settings
    music_dir = get_settings().MUSIC_DIR

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(DailyPlaylist).where(DailyPlaylist.consumed == False)  # noqa: E712
        )
        playlists = result.scalars().all()

        for pl in playlists:
            songs_payload = pl.songs or []
            kept = []
            removed = []
            failed_fills = []

            for entry in songs_payload:
                if entry.get("_genre") or entry.get("_artist_of_day"):
                    kept.append(entry)
                    continue

                artist = (entry.get("artist") or "").strip()
                title = (entry.get("title") or "").strip()

                resolvable = await _is_resolvable(db, artist, title, music_dir)
                if resolvable:
                    kept.append(entry)
                    continue

                # Count LLM attempts so far (tracked via pipeline_log marker)
                llm_attempts = await _count_llm_attempts(db, artist, title, str(pl.id))
                if llm_attempts < _LLM_ALT_MAX:
                    alt_queued = await _try_llm_alternative(db, pl, entry, artist, title)
                    if alt_queued:
                        kept.append(entry)  # keep original entry; new download in progress
                        log.info("cleanup: queued LLM alt #%d for '%s - %s'", llm_attempts + 1, artist, title)
                        continue

                # Give up — remove from playlist
                removed.append(f"{artist} - {title}")
                if llm_attempts >= _LLM_ALT_MAX:
                    failed_fills.append(f"{artist} - {title}")

            if removed:
                log.info(
                    "playlist_health: cleanup removed %d songs from playlist %s (slot=%s): %s",
                    len(removed), str(pl.id)[:8], pl.slot, ", ".join(removed),
                )
                real_kept = [s for s in kept if not s.get("_genre") and not s.get("_artist_of_day")]
                if not real_kept:
                    pl.consumed = True
                    log.warning("playlist_health: playlist %s emptied, marking consumed", str(pl.id)[:8])
                else:
                    pl.songs = kept
                    flag_modified(pl, "songs")

                if failed_fills:
                    db.add(UserNotification(
                        type="failed_to_fill",
                        message=f"Could not find replacements for: {', '.join(failed_fills[:3])}" +
                                (f" (+{len(failed_fills)-3} more)" if len(failed_fills) > 3 else ""),
                    ))

        await db.commit()


# ── LLM alternative ───────────────────────────────────────────────────────────

async def _try_llm_alternative(db, pl, entry: dict, artist: str, title: str) -> bool:
    """Ask LLM for an alternative to a failed song. Returns True if alt was queued."""
    try:
        llm = _get_llm()
        if not llm:
            return False

        # Load profile context for better suggestions
        profile_songs_ctx = await _load_profile_context(db, pl.profile_id)

        prompt = (
            f"The song \"{artist} - {title}\" could not be downloaded for a {pl.slot} playlist. "
            f"Suggest exactly ONE alternative track in the same style.\n"
            f"Profile taste context: {profile_songs_ctx}\n"
            "Reply with JSON only: {\"artist\": \"...\", \"title\": \"...\"}"
        )
        import json
        raw = await llm.complete([{"role": "user", "content": prompt}])
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        alt = json.loads(raw)
        alt_artist = alt.get("artist", "").strip()
        alt_title = alt.get("title", "").strip()
        if not alt_artist or not alt_title:
            return False

        # Queue download with LLM-alt marker in pipeline_log placeholder
        from ..services.download_pipeline import request_download
        from ..services.mb_resolver import resolve_recording
        mb_id = await resolve_recording(alt_artist, alt_title)
        job = await request_download(
            db, "track", alt_artist, alt_title,
            mb_recording_id=mb_id,
            playlist_id=_uuid.UUID(str(pl.id)),
        )
        # Tag job so we can count attempts
        log_entry = {
            "step": "llm_alternative",
            "ts": datetime.now(timezone.utc).isoformat(),
            "status": "ok",
            "message": f"LLM alternative for: {artist} - {title}",
            "data": {"llm_alt_for": f"{artist} - {title}", "playlist_id": str(pl.id)},
        }
        job.pipeline_log = list(job.pipeline_log or []) + [log_entry]
        log.info("_try_llm_alternative: queued '%s - %s' as alt for '%s - %s'", alt_artist, alt_title, artist, title)
        return True

    except Exception as e:
        log.warning("_try_llm_alternative: failed for '%s - %s': %s", artist, title, e)
        return False


async def _count_llm_attempts(db, artist: str, title: str, playlist_id: str) -> int:
    """Count how many LLM alternatives have been tried for this original song."""
    target = f"{artist} - {title}".lower()
    result = await db.execute(
        select(DownloadJob).where(
            DownloadJob.pipeline_log.isnot(None),
        )
    )
    count = 0
    for job in result.scalars().all():
        for entry in (job.pipeline_log or []):
            data = entry.get("data") or {}
            if (entry.get("step") == "llm_alternative"
                    and data.get("llm_alt_for", "").lower() == target
                    and data.get("playlist_id") == playlist_id):
                count += 1
    return count


# ── helpers ───────────────────────────────────────────────────────────────────

def _get_llm():
    try:
        from ..services.llm import get_llm_provider
        return get_llm_provider()
    except Exception:
        return None


async def _load_profile_context(db, profile_id) -> str:
    try:
        from sqlalchemy.orm import selectinload
        result = await db.execute(
            select(Song).where(Song.profile_id == profile_id)
            .options(selectinload(Song.artist))
            .limit(20)
        )
        songs = result.scalars().all()
        return ", ".join(
            f"{s.display_artist or (s.artist.name if s.artist else '')} - {s.title}"
            for s in songs[:10]
        )
    except Exception:
        return ""


async def _is_resolvable(db, artist: str, title: str, music_dir: str) -> bool:
    from sqlalchemy import or_

    r = await db.execute(
        select(Song.id)
        .join(Artist, Song.artist_id == Artist.id, isouter=True)
        .where(
            func.lower(Song.title) == title.lower(),
            or_(
                func.lower(func.coalesce(Song.display_artist, "")) == artist.lower(),
                func.lower(func.coalesce(Artist.name, "")) == artist.lower(),
            ),
        ).limit(1)
    )
    if r.first():
        return True

    r = await db.execute(
        select(Song.id).where(func.lower(Song.title) == title.lower()).limit(1)
    )
    if r.first():
        return True

    if title:
        r = await db.execute(
            select(Song.id).where(Song.title.ilike(f"%{title}%")).limit(1)
        )
        if r.first():
            return True

    if title and artist:
        words = [w for w in title.split() if len(w) > 3]
        if len(words) >= 2:
            from sqlalchemy import or_
            pat = f"%{words[0]}%{words[-1]}%"
            r = await db.execute(
                select(Song.id)
                .join(Artist, Song.artist_id == Artist.id, isouter=True)
                .where(
                    Song.title.ilike(pat),
                    or_(
                        func.lower(func.coalesce(Song.display_artist, "")) == artist.lower(),
                        func.lower(func.coalesce(Artist.name, "")) == artist.lower(),
                    ),
                ).limit(1)
            )
            if r.first():
                return True

    if artist and title:
        job_r = await db.execute(
            select(DownloadJob.file_path).where(
                DownloadJob.status == "completed",
                DownloadJob.file_path.isnot(None),
                func.lower(DownloadJob.artist) == artist.lower(),
                func.lower(DownloadJob.title) == title.lower(),
            ).limit(1)
        )
        job_row = job_r.first()
        if job_row and job_row.file_path:
            rel = job_row.file_path
            if rel.startswith(music_dir + "/"):
                rel = rel[len(music_dir) + 1:]
            r = await db.execute(
                select(Song.id).where(Song.file_path == rel).limit(1)
            )
            if r.first():
                return True

    return False


def _first_log_ts(job: DownloadJob) -> datetime | None:
    """Return the timestamp of the first pipeline_log entry."""
    entries = job.pipeline_log or []
    if not entries:
        return None
    try:
        from datetime import datetime, timezone
        ts_str = entries[0].get("ts", "")
        if ts_str:
            return datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
    except Exception:
        pass
    return None
