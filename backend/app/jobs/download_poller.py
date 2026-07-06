"""APScheduler job: poll qBittorrent every 2 min for completed music downloads."""
import asyncio
import logging
import os
import shutil
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update, and_, or_

from ..core.database import AsyncSessionLocal
from ..models.events import DownloadJob
from ..services import qbittorrent
from ..services.essentia_svc import analyse_pending_songs
from ..services.navidrome import trigger_scan

log = logging.getLogger(__name__)

_AUDIO_EXTS = {'.flac', '.mp3', '.m4a', '.ogg', '.opus', '.aac', '.wav'}


def _collect_audio_files(content_path: str) -> list[str]:
    """Return all audio files at content_path (file or directory), sorted."""
    if not content_path or not os.path.exists(content_path):
        return []
    if os.path.isfile(content_path):
        return [content_path] if os.path.splitext(content_path)[1].lower() in _AUDIO_EXTS else []
    result = []
    for root, _, files in os.walk(content_path):
        for f in sorted(files):
            if os.path.splitext(f)[1].lower() in _AUDIO_EXTS:
                result.append(os.path.join(root, f))
    return result


def _move_to_music_dir(file_path: str, music_dir: str, suffix: str = "") -> str:
    """Move file_path into music_dir. Returns new path. Never raises."""
    dest_name = os.path.basename(file_path)
    dest_path = os.path.join(music_dir, dest_name)
    if os.path.exists(dest_path):
        base, ext = os.path.splitext(dest_name)
        dest_path = os.path.join(music_dir, f"{base}_{suffix or 'dup'}{ext}")
    try:
        shutil.move(file_path, dest_path)
        log.info("qb_poller: moved → %s", dest_path)
        return dest_path
    except Exception as e:
        log.warning("qb_poller: move failed %s → %s: %s", file_path, dest_path, e)
        return file_path  # return original if move failed


def _best_file_for_job(title: str, candidates: list[str]) -> str:
    """Pick the audio file whose filename best matches title using rapidfuzz."""
    if len(candidates) == 1:
        return candidates[0]
    try:
        from rapidfuzz import fuzz
        best_score = -1.0
        best = candidates[0]
        title_lower = title.lower()
        for path in candidates:
            stem = os.path.splitext(os.path.basename(path))[0].lower()
            score = fuzz.partial_ratio(title_lower, stem)
            if score > best_score:
                best_score = score
                best = path
        return best
    except Exception:
        return candidates[0]


async def _reset_stale_prowlarr_jobs() -> None:
    """Prowlarr jobs in qBittorrent with 0 progress for 1h → failed for immediate retry."""
    import time

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(DownloadJob).where(
                DownloadJob.status == "downloading",
                DownloadJob.qb_hash.isnot(None),
            )
        )
        jobs_with_hash = result.scalars().all()
        if not jobs_with_hash:
            return

        all_torrents = await qbittorrent.get_torrents(category="music", filter="all")
        torrent_map = {t["hash"]: t for t in all_torrents}
        now_ts = time.time()

        reset_ids = []
        for job in jobs_with_hash:
            t = torrent_map.get(job.qb_hash or "")
            if t is None:
                continue  # torrent not in qBittorrent — pipeline may be mid-run
            progress = t.get("progress", 0)
            added_on = t.get("added_on", now_ts)  # Unix timestamp from qBittorrent
            torrent_age_hours = (now_ts - added_on) / 3600
            # Only reset if torrent has been in qBittorrent for 1h+ with no progress
            if progress < 0.01 and torrent_age_hours >= 1:
                reset_ids.append(job.id)
                try:
                    await qbittorrent.delete_torrent(job.qb_hash)
                except Exception:
                    pass
                log.warning(
                    "qb_poller: stale prowlarr job → failed: %s - %s (hash=%s age=%.1fh)",
                    job.artist, job.title, (job.qb_hash or "")[:8], torrent_age_hours,
                )

        if reset_ids:
            now = datetime.now(timezone.utc)
            await db.execute(
                update(DownloadJob)
                .where(DownloadJob.id.in_(reset_ids))
                .values(
                    status="failed",
                    last_error="prowlarr torrent stalled (no seeders)",
                    next_retry_at=now - timedelta(minutes=1),
                    qb_hash=None,
                )
            )
            await db.commit()
            log.info("qb_poller: reset %d stale prowlarr jobs to failed", len(reset_ids))


async def _reset_stale_pipeline_jobs() -> None:
    """Non-prowlarr pipeline jobs stuck in 'downloading' for >2h → failed for retry.

    Uses pipeline_log[0].ts as the start timestamp (reset on each retry, so it
    accurately reflects the current run, not the original job creation time).
    """
    from sqlalchemy import text as _text

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(DownloadJob).where(
                DownloadJob.status == "downloading",
                DownloadJob.qb_hash.is_(None),
                _text(
                    "jsonb_array_length(pipeline_log) > 0"
                    " AND (pipeline_log -> 0 ->> 'ts')::timestamptz"
                    " < NOW() - INTERVAL '2 hours'"
                ),
            )
        )
        stale_jobs = result.scalars().all()
        if not stale_jobs:
            return

        now = datetime.now(timezone.utc)
        stale_ids = [j.id for j in stale_jobs]
        for job in stale_jobs:
            log.warning(
                "qb_poller: pipeline job stuck >2h → failed: %s - %s (id=%s)",
                job.artist, job.title, str(job.id)[:8],
            )

        await db.execute(
            update(DownloadJob)
            .where(DownloadJob.id.in_(stale_ids))
            .values(
                status="failed",
                last_error="pipeline stuck >2h — auto-reset for retry",
                next_retry_at=now - timedelta(minutes=1),
            )
        )
        await db.commit()
        log.info("qb_poller: reset %d stale pipeline jobs to failed", len(stale_ids))


async def _reset_stale_queued_jobs() -> None:
    """Jobs stuck at 'queued' for >2h mean their pipeline task never ran or was
    lost (e.g. GC'd fire-and-forget task, event-loop crash). Flip them to
    'failed' with an immediate next_retry_at so the retry job re-runs them —
    previously these were only rescued by a container restart.

    Jobs can legitimately sit at 'queued' while waiting on the pipeline
    semaphore; _run_pipeline_inner double-checks the status on entry, so a
    false-positive rescue is skipped by the still-alive task and simply
    re-queued by the retry job (no duplicate download).
    """
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        result = await db.execute(
            update(DownloadJob)
            .where(
                DownloadJob.status == "queued",
                DownloadJob.created_at < now - timedelta(hours=2),
            )
            .values(
                status="failed",
                last_error="stuck at queued >30min — pipeline task lost, auto-reset",
                next_retry_at=now - timedelta(minutes=1),
            )
        )
        await db.commit()
        if result.rowcount:
            log.warning("qb_poller: rescued %d jobs stuck at 'queued'", result.rowcount)


async def poll_completed_downloads() -> None:
    await _reset_stale_prowlarr_jobs()
    await _reset_stale_pipeline_jobs()
    await _reset_stale_queued_jobs()
    completed = await qbittorrent.get_torrents(category="music", filter="completed")
    if not completed:
        return

    torrent_map = {t["hash"]: t for t in completed}
    completed_hashes = set(torrent_map.keys())

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(DownloadJob).where(
                DownloadJob.qb_hash.in_(completed_hashes),
                or_(
                    DownloadJob.status.in_(["queued", "downloading"]),
                    and_(
                        DownloadJob.status == "completed",
                        DownloadJob.file_path.is_(None),
                    ),
                ),
            )
        )
        jobs = result.scalars().all()

        if not jobs:
            return

        from ..core.config import get_settings
        music_dir = get_settings().MUSIC_DIR

        # Group jobs by qb_hash so we process each torrent once
        jobs_by_hash: dict[str, list[DownloadJob]] = defaultdict(list)
        for job in jobs:
            jobs_by_hash[job.qb_hash or ""].append(job)

        new_completions = False
        newly_completed: list[dict] = []  # track {id, playlist_id, file_path, artist} for playlist hook

        for qb_hash, hash_jobs in jobs_by_hash.items():
            torrent = torrent_map.get(qb_hash, {})
            content_path = torrent.get("content_path") or ""

            # Collect all audio files from this torrent
            raw_files = _collect_audio_files(content_path)

            # Move every file from staging into MUSIC_DIR (idempotent if already there)
            moved_files: list[str] = []
            for f in raw_files:
                if not f.startswith(music_dir):
                    f = _move_to_music_dir(f, music_dir, suffix=str(hash_jobs[0].id)[:8])
                moved_files.append(f)

            # Match each job to its best-matching file
            for job in hash_jobs:
                if moved_files:
                    assigned = _best_file_for_job(job.title, moved_files)
                else:
                    assigned = None

                was_pending = job.status in ("queued", "downloading")
                values: dict = {"file_path": assigned}
                if was_pending:
                    values["status"] = "completed"
                    values["completed_at"] = datetime.now(timezone.utc)
                    values["auto_expires_at"] = datetime.now(timezone.utc) + timedelta(minutes=30)
                    new_completions = True
                    if assigned:
                        newly_completed.append({
                            "id": job.id,
                            "daily_playlist_id": job.playlist_id,  # daily playlist FK (staging)
                            "playlist_id": job.user_playlist_id,   # user playlist FK
                            "profile_id": job.profile_id,
                            "file_path": assigned,
                            "artist": job.artist,
                            "title": job.title,
                            "mb_recording_id": job.mb_recording_id,
                        })

                await db.execute(
                    update(DownloadJob).where(DownloadJob.id == job.id).values(**values)
                )
                log.info(
                    "qb_poller: %s %s - %s → %s",
                    "completed" if was_pending else "backfilled",
                    job.artist, job.title,
                    assigned or "(not found)",
                )

                # Write MB tags into matched file
                if assigned and job.mb_recording_id:
                    try:
                        from ..services.musicbrainz import get_recording
                        from ..services.download_pipeline import _write_mb_tags
                        mb_rec = await get_recording(job.mb_recording_id)
                        fallback_rec = {
                            "title": mb_rec.get("title") or job.title,
                            "artist_name": mb_rec.get("artist_name") or job.artist,
                            "release_title": mb_rec.get("release_title"),
                            "isrc": mb_rec.get("isrc"),
                            "recording_id": mb_rec.get("recording_id"),
                        }
                        wrote = await _write_mb_tags(assigned, fallback_rec)
                        if wrote:
                            log.info("qb_poller: wrote MB tags to %s", assigned)
                    except Exception as e:
                        log.warning("qb_poller: MB tag write failed for job %s: %s", job.id, e)

        await db.commit()

    if new_completions:
        await trigger_scan()
        await asyncio.sleep(10)
        from .library_sync import run_library_sync
        await run_library_sync()
        await analyse_pending_songs()

        # Assign completed songs to their profile
        profile_jobs = [j for j in newly_completed if j.get("profile_id")]
        if profile_jobs:
            from ..models.library import Song as _Song
            from sqlalchemy import func as _func_p
            from datetime import timedelta as _td_p
            async with AsyncSessionLocal() as prof_db:
                try:
                    for completed in profile_jobs:
                        rel = completed["file_path"]
                        if rel.startswith(music_dir + "/"):
                            rel = rel[len(music_dir) + 1:]
                        song_q = await prof_db.execute(select(_Song).where(_Song.file_path == rel))
                        song = song_q.scalar_one_or_none()
                        if song is None and completed.get("mb_recording_id"):
                            song_q = await prof_db.execute(select(_Song).where(_Song.mb_recording_id == completed["mb_recording_id"]))
                            song = song_q.scalar_one_or_none()
                        if song is None and completed.get("title") and completed.get("artist"):
                            cutoff = datetime.now(timezone.utc) - _td_p(minutes=15)
                            song_q = await prof_db.execute(
                                select(_Song).where(
                                    _func_p.lower(_Song.title) == completed["title"].lower(),
                                    _Song.display_artist.ilike(completed["artist"]),
                                    _Song.added_at >= cutoff,
                                ).order_by(_Song.added_at.desc()).limit(1)
                            )
                            song = song_q.scalar_one_or_none()
                        if song:
                            song.profile_id = completed["profile_id"]
                            song.needs_profile_assignment = False
                    await prof_db.commit()
                except Exception as e:
                    log.warning("qb_poller: profile assignment failed: %s", e)

        # Stage songs downloaded for daily playlists (hidden until playlist processed).
        # Also write song UUID back into DailyPlaylist JSONB so EOD can identify it.
        staged_jobs = [j for j in newly_completed if j.get("daily_playlist_id") and j.get("file_path")]
        if staged_jobs:
            from ..models.library import Song as _Song
            from ..models.discovery import DailyPlaylist as _DP
            from sqlalchemy.orm.attributes import flag_modified as _fm_dp
            from sqlalchemy import func as _func_s
            from datetime import timedelta as _td_s
            async with AsyncSessionLocal() as stage_db:
                try:
                    for completed in staged_jobs:
                        rel = completed["file_path"]
                        if rel.startswith(music_dir + "/"):
                            rel = rel[len(music_dir) + 1:]
                        song_q = await stage_db.execute(select(_Song).where(_Song.file_path == rel))
                        song = song_q.scalar_one_or_none()
                        if song is None and completed.get("mb_recording_id"):
                            song_q = await stage_db.execute(select(_Song).where(_Song.mb_recording_id == completed["mb_recording_id"]))
                            song = song_q.scalar_one_or_none()
                        if song is None and completed.get("title") and completed.get("artist"):
                            cutoff = datetime.now(timezone.utc) - _td_s(minutes=15)
                            song_q = await stage_db.execute(
                                select(_Song).where(
                                    _func_s.lower(_Song.title) == completed["title"].lower(),
                                    _Song.display_artist.ilike(completed["artist"]),
                                    _Song.added_at >= cutoff,
                                ).order_by(_Song.added_at.desc()).limit(1)
                            )
                            song = song_q.scalar_one_or_none()
                        if song and not song.profile_id:
                            song.is_staged = True
                            # Update DailyPlaylist JSONB with song UUID so EOD can track it
                            pl_id = completed["daily_playlist_id"]
                            pl_obj = await stage_db.get(_DP, pl_id)
                            if pl_obj and pl_obj.songs:
                                songs_list = list(pl_obj.songs)
                                job_artist = (completed.get("artist") or "").lower()
                                job_title = (completed.get("title") or "").lower()
                                for entry in songs_list:
                                    if entry.get("id") or entry.get("_genre") or entry.get("_artist_of_day"):
                                        continue
                                    ea = (entry.get("artist") or "").lower()
                                    et = (entry.get("title") or "").lower()
                                    if ea == job_artist and et == job_title:
                                        entry["id"] = str(song.id)
                                        entry["navidrome_id"] = song.navidrome_id or ""
                                        pl_obj.songs = songs_list
                                        _fm_dp(pl_obj, "songs")
                                        break
                    await stage_db.commit()
                except Exception as e:
                    log.warning("qb_poller: staging failed: %s", e)

        # Auto-add newly completed prowlarr jobs to their UserPlaylist
        playlist_jobs = [j for j in newly_completed if j.get("playlist_id")]
        if playlist_jobs:
            from ..models.library import Song as _Song
            from ..models.playlists import UserPlaylist as _UPL
            from sqlalchemy.orm.attributes import flag_modified as _fm
            from sqlalchemy import func as _func_u
            from datetime import timedelta as _td_u
            async with AsyncSessionLocal() as upl_db:
                try:
                    for completed in playlist_jobs:
                        rel = completed["file_path"]
                        if rel.startswith(music_dir + "/"):
                            rel = rel[len(music_dir) + 1:]
                        song_q = await upl_db.execute(select(_Song).where(_Song.file_path == rel))
                        song = song_q.scalar_one_or_none()
                        if song is None and completed.get("mb_recording_id"):
                            song_q = await upl_db.execute(select(_Song).where(_Song.mb_recording_id == completed["mb_recording_id"]))
                            song = song_q.scalar_one_or_none()
                        if song is None and completed.get("title") and completed.get("artist"):
                            cutoff = datetime.now(timezone.utc) - _td_u(minutes=15)
                            song_q = await upl_db.execute(
                                select(_Song).where(
                                    _func_u.lower(_Song.title) == completed["title"].lower(),
                                    _Song.display_artist.ilike(completed["artist"]),
                                    _Song.added_at >= cutoff,
                                ).order_by(_Song.added_at.desc()).limit(1)
                            )
                            song = song_q.scalar_one_or_none()
                            if song:
                                log.info("qb_poller: found song via title+artist fallback for '%s - %s'", completed["artist"], completed["title"])
                        if not song:
                            continue
                        upl = await upl_db.get(_UPL, completed["playlist_id"])
                        if not upl:
                            continue
                        songs_list = list(upl.songs or [])
                        if str(song.id) in {s.get("id") for s in songs_list}:
                            continue
                        artist_name = song.display_artist or completed["artist"]
                        songs_list.append({
                            "id": str(song.id),
                            "navidrome_id": song.navidrome_id or "",
                            "title": song.title,
                            "artist": artist_name,
                            "duration_sec": song.duration_sec or 0,
                        })
                        upl.songs = songs_list
                        _fm(upl, "songs")
                        log.info("qb_poller: playlist '%s' ← '%s - %s'", upl.name, artist_name, song.title)
                    await upl_db.commit()
                except Exception as e:
                    log.warning("qb_poller: playlist update failed: %s", e)
