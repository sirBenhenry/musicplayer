"""End-of-day batch: process daily playlists by slot type, then delete stale songs.

Slot behaviour:
  close / broader  → REFILL: process ≥5 interacted songs, keep playlist alive, fill holes
  genre            → PROMPT: process at 80%, create genre_prompt notification for user
  artist           → PROMPT: process at 80%, create artist_prompt notification for user

Reliability:
  - Each playlist processed in its own try/except — failures never crash the full batch
  - Staged guard: only delete songs where is_staged=True
  - Atomic commit per playlist: partial failures leave playlist at consumed=False
"""
import logging
import os
import uuid
from datetime import datetime, timezone
from sqlalchemy import select, delete

from ..core.database import AsyncSessionLocal
from ..models.discovery import DailyPlaylist
from ..models.events import PendingDeletion, SongEvent, UserNotification
from ..models.library import Song
from ..services.navidrome import trigger_scan

log = logging.getLogger(__name__)

_COMPLETION_THRESHOLD = 0.80    # genre/artist slots: fraction of songs to trigger processing
_CLOSE_REFILL_MIN = 5           # close/broader slots: absolute count of interactions to trigger refill
_PLAYLIST_TARGET_SIZE = 9       # how many songs to fill back up to after refill


async def run_eod_batch() -> dict:
    log.info("EOD batch started")
    stats = {
        "playlists_processed": 0,
        "songs_assigned": 0,
        "songs_deleted": 0,
        "refills_triggered": 0,
        "errors": 0,
    }

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(DailyPlaylist).where(DailyPlaylist.consumed == False)  # noqa: E712
        )
        playlists = result.scalars().all()

        candidates = []
        for pl in playlists:
            songs_payload = pl.songs or []
            real_songs = [s for s in songs_payload if not s.get("_genre") and not s.get("_artist_of_day")]
            known_songs = [s for s in real_songs if s.get("id")]
            if not known_songs:
                continue

            known_ids = {s["id"] for s in known_songs}

            lt_result = await db.execute(
                select(SongEvent.song_id).where(
                    SongEvent.playlist_id == pl.id,
                    SongEvent.event_type == "listen_through",
                    SongEvent.song_id.isnot(None),
                )
            )
            listened_ids = {str(r[0]) for r in lt_result.all()}

            pd_result = await db.execute(
                select(PendingDeletion.song_id).where(
                    PendingDeletion.playlist_id == pl.id,
                    PendingDeletion.rescued == False,  # noqa: E712
                )
            )
            skipped_ids = {str(r[0]) for r in pd_result.all()}

            interacted_known = (listened_ids | skipped_ids) & known_ids
            completion = len(interacted_known) / len(known_ids)

            log.info(
                "EOD: playlist %s slot=%s — interacted=%d/%d (%.0f%%)",
                str(pl.id)[:8], pl.slot, len(interacted_known), len(known_ids), completion * 100,
            )

            if pl.slot in ("close", "broader"):
                if len(interacted_known) >= _CLOSE_REFILL_MIN:
                    candidates.append((pl, listened_ids, skipped_ids, known_ids))
            else:
                if completion >= _COMPLETION_THRESHOLD:
                    candidates.append((pl, listened_ids, skipped_ids, known_ids))

        await db.commit()

    need_rescan = False
    for pl, listened_ids, skipped_ids, known_ids in candidates:
        try:
            result = await _dispatch_playlist(pl, listened_ids, skipped_ids, known_ids)
            stats["playlists_processed"] += 1
            stats["songs_assigned"] += result.get("assigned", 0)
            stats["songs_deleted"] += result.get("deleted", 0)
            if result.get("refill"):
                stats["refills_triggered"] += 1
            if result.get("deleted", 0) > 0:
                need_rescan = True
        except Exception as e:
            log.error("EOD: failed to process playlist %s (slot=%s): %s", str(pl.id)[:8], pl.slot, e, exc_info=True)
            stats["errors"] += 1

    deleted_extra, rescan_needed = await _process_pending_deletions()
    stats["songs_deleted"] += deleted_extra
    if rescan_needed:
        need_rescan = True

    if need_rescan:
        try:
            await trigger_scan()
        except Exception as e:
            log.warning("EOD: Navidrome rescan failed: %s", e)

    log.info("EOD batch complete: %s", stats)
    return stats


async def _dispatch_playlist(pl, listened_ids, skipped_ids, known_ids):
    if pl.slot in ("close", "broader"):
        return await _process_close_broader(pl, listened_ids, skipped_ids, known_ids)
    elif pl.slot == "genre":
        return await _process_genre(pl, listened_ids, skipped_ids, known_ids)
    elif pl.slot == "artist":
        return await _process_artist(pl, listened_ids, skipped_ids, known_ids)
    return {}


# ── close / broader ──────────────────────────────────────────────────────────

async def _process_close_broader(pl, listened_ids, skipped_ids, known_ids):
    """Process interacted songs, remove from JSONB, refill holes. Keep consumed=False."""
    from ..core.config import get_settings
    from sqlalchemy.orm import flag_modified

    assigned = 0
    deleted = 0
    music_dir = get_settings().MUSIC_DIR
    interacted = (listened_ids | skipped_ids) & known_ids

    async with AsyncSessionLocal() as db:
        pl_obj = await db.get(DailyPlaylist, pl.id)
        if not pl_obj:
            return {}

        # Load songs that were interacted with
        song_uuids = [uuid.UUID(sid) for sid in interacted if _valid_uuid(sid)]
        songs_result = await db.execute(select(Song).where(Song.id.in_(song_uuids)))
        songs = {str(s.id): s for s in songs_result.scalars().all()}

        processed_ids: set[str] = set()

        for song_id, song in songs.items():
            if song_id in listened_ids:
                if not song.is_staged:
                    log.warning("EOD: song %s not staged but kept — assigning anyway", song_id)
                song.profile_id = pl.profile_id
                song.is_staged = False
                song.needs_profile_assignment = False
                assigned += 1
                processed_ids.add(song_id)
            elif song_id in skipped_ids:
                if not song.is_staged:
                    # Safety guard: never delete a non-staged (library) song
                    log.warning("EOD: skipping delete of non-staged song %s — already in library", song_id)
                    processed_ids.add(song_id)
                    continue
                _delete_song_file(song, music_dir)
                await db.delete(song)
                deleted += 1
                processed_ids.add(song_id)

        # Remove processed songs from playlist JSONB
        current_songs = [
            s for s in (pl_obj.songs or [])
            if not (s.get("id") and s["id"] in processed_ids)
        ]
        pl_obj.songs = current_songs
        flag_modified(pl_obj, "songs")

        # Clean up events only for processed songs
        if processed_ids:
            proc_uuids = [uuid.UUID(sid) for sid in processed_ids if _valid_uuid(sid)]
            await db.execute(
                delete(PendingDeletion).where(
                    PendingDeletion.playlist_id == pl.id,
                    PendingDeletion.song_id.in_(proc_uuids),
                )
            )
            await db.execute(
                delete(SongEvent).where(
                    SongEvent.playlist_id == pl.id,
                    SongEvent.song_id.in_(proc_uuids),
                )
            )

        await db.commit()

    log.info("EOD close/broader %s: assigned=%d deleted=%d", str(pl.id)[:8], assigned, deleted)

    # Refill holes in background
    try:
        from ..discovery.pipeline import refill_playlist
        await refill_playlist(pl)
    except Exception as e:
        log.error("EOD: refill failed for playlist %s: %s", str(pl.id)[:8], e)

    return {"assigned": assigned, "deleted": deleted, "refill": True}


# ── genre ────────────────────────────────────────────────────────────────────

async def _process_genre(pl, listened_ids, skipped_ids, known_ids):
    """Process songs, create genre_prompt notification, mark consumed."""
    from ..core.config import get_settings

    assigned = 0
    deleted = 0
    music_dir = get_settings().MUSIC_DIR
    genre_name = _extract_marker(pl.songs or [], "_genre")

    async with AsyncSessionLocal() as db:
        song_uuids = [uuid.UUID(sid) for sid in known_ids if _valid_uuid(sid)]
        songs_result = await db.execute(select(Song).where(Song.id.in_(song_uuids)))
        songs = {str(s.id): s for s in songs_result.scalars().all()}

        kept_song_ids = []

        for song_id, song in songs.items():
            if song_id in listened_ids:
                if not song.is_staged:
                    log.warning("EOD genre: song %s not staged — keeping anyway for prompt", song_id)
                # Keep in staging until user accepts prompt
                kept_song_ids.append(song_id)
                assigned += 1
            else:
                if not song.is_staged:
                    log.warning("EOD genre: skipping delete of non-staged song %s", song_id)
                    continue
                _delete_song_file(song, music_dir)
                await db.delete(song)
                deleted += 1

        if kept_song_ids and genre_name:
            db.add(UserNotification(
                type="genre_prompt",
                message=f"New genre explored: {genre_name}. {len(kept_song_ids)} song(s) saved. Where do you want to add them?",
                data={
                    "genre_name": genre_name,
                    "song_ids": kept_song_ids,
                    "playlist_profile_id": str(pl.profile_id),
                },
            ))

        pl_obj = await db.get(DailyPlaylist, pl.id)
        if pl_obj:
            pl_obj.consumed = True

        await db.execute(delete(PendingDeletion).where(PendingDeletion.playlist_id == pl.id))
        await db.execute(delete(SongEvent).where(SongEvent.playlist_id == pl.id))
        await db.commit()

    log.info("EOD genre %s: assigned=%d deleted=%d genre=%s", str(pl.id)[:8], assigned, deleted, genre_name)
    return {"assigned": assigned, "deleted": deleted}


# ── artist ───────────────────────────────────────────────────────────────────

async def _process_artist(pl, listened_ids, skipped_ids, known_ids):
    """Process songs, determine follow/add action, create artist_prompt notification."""
    from ..core.config import get_settings
    from sqlalchemy.orm import selectinload

    assigned = 0
    deleted = 0
    music_dir = get_settings().MUSIC_DIR
    artist_of_day = _extract_marker(pl.songs or [], "_artist_of_day")

    async with AsyncSessionLocal() as db:
        song_uuids = [uuid.UUID(sid) for sid in known_ids if _valid_uuid(sid)]
        songs_result = await db.execute(
            select(Song).where(Song.id.in_(song_uuids))
            .options(selectinload(Song.artist))
        )
        songs = {str(s.id): s for s in songs_result.scalars().all()}

        kept_song_ids = []
        artist_name = artist_of_day or ""
        artist_mb_id = None

        for song_id, song in songs.items():
            if not artist_name and song.artist:
                artist_name = song.artist.name
                artist_mb_id = song.artist.musicbrainz_id
            if song_id in listened_ids:
                if not song.is_staged:
                    log.warning("EOD artist: song %s not staged — keeping anyway for prompt", song_id)
                kept_song_ids.append(song_id)
                assigned += 1
            else:
                if not song.is_staged:
                    log.warning("EOD artist: skipping delete of non-staged song %s", song_id)
                    continue
                _delete_song_file(song, music_dir)
                await db.delete(song)
                deleted += 1

        if kept_song_ids and artist_name:
            artist_action = "follow" if len(kept_song_ids) == len(kept_song_ids | {s for s in known_ids if s in listened_ids}) and len(kept_song_ids) == len(known_ids) else "add"
            # Simpler: if ALL known songs were kept → follow, else → add
            all_kept = len(listened_ids & known_ids) == len(known_ids) and len(skipped_ids & known_ids) == 0
            artist_action = "follow" if all_kept else "add"

            db.add(UserNotification(
                type="artist_prompt",
                message=(
                    f"{'Follow' if artist_action == 'follow' else 'Add'} {artist_name}? "
                    f"{len(kept_song_ids)} song(s) saved from Artist of the Day."
                ),
                data={
                    "artist_name": artist_name,
                    "artist_mb_id": artist_mb_id,
                    "action": artist_action,
                    "song_ids": kept_song_ids,
                    "playlist_profile_id": str(pl.profile_id),
                },
            ))

        pl_obj = await db.get(DailyPlaylist, pl.id)
        if pl_obj:
            pl_obj.consumed = True

        await db.execute(delete(PendingDeletion).where(PendingDeletion.playlist_id == pl.id))
        await db.execute(delete(SongEvent).where(SongEvent.playlist_id == pl.id))
        await db.commit()

    log.info("EOD artist %s: assigned=%d deleted=%d artist=%s", str(pl.id)[:8], assigned, deleted, artist_name)
    return {"assigned": assigned, "deleted": deleted}


# ── library-level pending deletions ──────────────────────────────────────────

async def _process_pending_deletions() -> tuple[int, bool]:
    """Delete songs in PendingDeletion with no playlist_id (library-level skips)."""
    from ..core.config import get_settings

    deleted = 0
    need_rescan = False
    music_dir = get_settings().MUSIC_DIR

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PendingDeletion).where(
                PendingDeletion.rescued == False,  # noqa: E712
                PendingDeletion.playlist_id.is_(None),
            )
        )
        pending = result.scalars().all()

        for pd in pending:
            song = await db.get(Song, pd.song_id)
            if not song:
                await db.delete(pd)
                continue
            _delete_song_file(song, music_dir)
            need_rescan = True
            await db.delete(pd)
            await db.delete(song)
            deleted += 1

        await db.commit()

    return deleted, need_rescan


# ── helpers ───────────────────────────────────────────────────────────────────

def _delete_song_file(song: Song, music_dir: str) -> None:
    if not song.file_path:
        return
    abs_path = song.file_path if song.file_path.startswith("/") else os.path.join(music_dir, song.file_path)
    if os.path.exists(abs_path):
        try:
            os.remove(abs_path)
        except OSError as e:
            log.error("EOD: failed to delete file %s: %s", abs_path, e)


def _extract_marker(songs: list, key: str) -> str | None:
    for s in songs:
        if s.get(key):
            return s[key]
    return None


def _valid_uuid(s: str) -> bool:
    try:
        uuid.UUID(s)
        return True
    except (ValueError, AttributeError):
        return False
