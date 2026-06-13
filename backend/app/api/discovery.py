"""Discovery API — daily playlists, pause, manual trigger, song flag override."""
import asyncio
import logging
import uuid as _uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import require_auth
from ..core.database import get_db
from ..models.discovery import DailyPlaylist
from ..models.events import PendingDeletion, SongEvent
from ..models.library import Artist, Song

router = APIRouter(prefix="/discovery", tags=["discovery"])
log = logging.getLogger(__name__)


@router.get("/today")
async def get_today(
    profile_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    date_q = select(func.max(DailyPlaylist.date)).where(
        DailyPlaylist.consumed == False,  # noqa: E712
        DailyPlaylist.paused_to_tomorrow == False,  # noqa: E712
    )
    if profile_id:
        date_q = date_q.where(DailyPlaylist.profile_id == profile_id)
    date_result = await db.execute(date_q)
    latest_date = date_result.scalar_one_or_none()
    if not latest_date:
        return []

    q = select(DailyPlaylist).where(
        DailyPlaylist.date == latest_date,
        DailyPlaylist.consumed == False,  # noqa: E712
        DailyPlaylist.paused_to_tomorrow == False,  # noqa: E712
    )
    if profile_id:
        q = q.where(DailyPlaylist.profile_id == profile_id)
    result = await db.execute(q)
    playlists = result.scalars().all()
    out = []
    for p in playlists:
        s = _serialize(p)
        s["songs"] = await _enrich_songs(db, s["songs"], p.id)
        out.append(s)
    return out


@router.get("/playlists")
async def list_playlists(
    profile_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    q = select(DailyPlaylist).order_by(DailyPlaylist.date.desc(), DailyPlaylist.slot)
    if profile_id:
        q = q.where(DailyPlaylist.profile_id == profile_id)
    result = await db.execute(q)
    playlists = result.scalars().all()
    return [_serialize_summary(p) for p in playlists]


@router.get("/playlists/{playlist_id}")
async def get_playlist(
    playlist_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    p = await db.get(DailyPlaylist, playlist_id)
    if not p:
        raise HTTPException(404, "Playlist not found")
    serialized = _serialize(p)
    serialized["songs"] = await _enrich_songs(db, serialized["songs"], p.id)
    return serialized


class FlagBody(BaseModel):
    action: str  # "keep" | "delete"


@router.patch("/playlists/{playlist_id}/songs/{song_id}/flag", status_code=200)
async def flag_song(
    playlist_id: str,
    song_id: str,
    body: FlagBody,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    """Manually set keep/delete flag for a song in a daily playlist. Idempotent."""
    try:
        pl_id = _uuid.UUID(playlist_id)
        s_id = _uuid.UUID(song_id)
    except ValueError:
        raise HTTPException(400, "Invalid UUID")

    pl = await db.get(DailyPlaylist, pl_id)
    if not pl:
        raise HTTPException(404, "Playlist not found")

    if body.action == "keep":
        # Rescue any pending deletion
        pd_res = await db.execute(
            select(PendingDeletion).where(
                PendingDeletion.song_id == s_id,
                PendingDeletion.playlist_id == pl_id,
            )
        )
        pd = pd_res.scalar_one_or_none()
        if pd:
            pd.rescued = True

        # Upsert listen_through event
        existing = await db.execute(
            select(SongEvent).where(
                SongEvent.song_id == s_id,
                SongEvent.playlist_id == pl_id,
                SongEvent.event_type == "listen_through",
            )
        )
        if not existing.scalar_one_or_none():
            db.add(SongEvent(
                song_id=s_id,
                playlist_id=pl_id,
                event_type="listen_through",
                progress_pct=1.0,
            ))

    elif body.action == "delete":
        # Ensure PendingDeletion exists and is not rescued
        existing_pd = await db.execute(
            select(PendingDeletion).where(
                PendingDeletion.song_id == s_id,
                PendingDeletion.playlist_id == pl_id,
            )
        )
        pd = existing_pd.scalar_one_or_none()
        if pd:
            pd.rescued = False
        else:
            db.add(PendingDeletion(song_id=s_id, playlist_id=pl_id))
    else:
        raise HTTPException(400, "action must be 'keep' or 'delete'")

    await db.commit()
    return {"flag": body.action, "song_id": song_id, "playlist_id": playlist_id}


@router.post("/playlists/{playlist_id}/consume")
async def consume_playlist(
    playlist_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    p = await db.get(DailyPlaylist, playlist_id)
    if not p:
        raise HTTPException(404, "Playlist not found")
    await db.execute(
        update(DailyPlaylist)
        .where(DailyPlaylist.id == playlist_id)
        .values(consumed=True)
    )
    await db.commit()
    return {"consumed": True}


@router.post("/playlists/{playlist_id}/pause")
async def pause_playlist(
    playlist_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    p = await db.get(DailyPlaylist, playlist_id)
    if not p:
        raise HTTPException(404, "Playlist not found")
    await db.execute(
        update(DailyPlaylist)
        .where(DailyPlaylist.id == playlist_id)
        .values(paused_to_tomorrow=True)
    )
    await db.commit()
    return {"paused": True}


@router.post("/generate")
async def trigger_generate(_: str = Depends(require_auth)):
    from ..discovery.pipeline import run_discovery
    asyncio.create_task(run_discovery())
    return {"status": "queued"}


async def _enrich_songs(db: AsyncSession, songs: list[dict], playlist_id=None) -> list[dict]:
    """Cross-reference playlist songs with library; add navidrome_id/duration_sec/id/flag.

    flag = 'keep' | 'delete' | None based on most recent SongEvent/PendingDeletion.
    """
    from ..models.events import DownloadJob
    from ..core.config import get_settings
    from sqlalchemy import or_
    music_dir = get_settings().MUSIC_DIR

    # Bulk-load flag state for entire playlist in one pass
    keep_ids: set[str] = set()
    delete_ids: set[str] = set()
    if playlist_id:
        try:
            pl_uuid = _uuid.UUID(str(playlist_id))
            lt_result = await db.execute(
                select(SongEvent.song_id).where(
                    SongEvent.playlist_id == pl_uuid,
                    SongEvent.event_type == "listen_through",
                    SongEvent.song_id.isnot(None),
                )
            )
            keep_ids = {str(r[0]) for r in lt_result.all()}

            pd_result = await db.execute(
                select(PendingDeletion.song_id).where(
                    PendingDeletion.playlist_id == pl_uuid,
                    PendingDeletion.rescued == False,  # noqa: E712
                    PendingDeletion.song_id.isnot(None),
                )
            )
            delete_ids = {str(r[0]) for r in pd_result.all()}
        except Exception as e:
            log.warning("_enrich_songs: flag load failed: %s", e)

    # Batch-resolve entries already stamped with their Song UUID (the staging
    # flow writes "id" back into the playlist JSONB). One IN query instead of
    # the 1-4 query cascade per song — this is the home screen's critical path.
    stamped_ids: set[str] = set()
    for song in songs:
        if song.get("_genre") or song.get("_artist_of_day"):
            continue
        sid = song.get("id")
        if sid:
            stamped_ids.add(str(sid))
    stamped_map: dict[str, tuple] = {}
    if stamped_ids:
        try:
            id_uuids = [_uuid.UUID(s) for s in stamped_ids]
            batch = await db.execute(
                select(Song.id, Song.navidrome_id, Song.duration_sec)
                .where(Song.id.in_(id_uuids))
            )
            stamped_map = {str(r.id): (r.navidrome_id, r.duration_sec) for r in batch.all()}
        except Exception as e:
            log.warning("_enrich_songs: batch id resolve failed: %s", e)

    enriched = []
    for song in songs:
        if song.get("_genre") or song.get("_artist_of_day"):
            enriched.append(song)
            continue
        artist = (song.get("artist") or "").strip()
        title = (song.get("title") or "").strip()

        row = None

        # 0. Stamped id — resolved in the batch above, skip the cascade.
        sid = song.get("id")
        if sid and str(sid) in stamped_map:
            nav_id, dur = stamped_map[str(sid)]
            song_id_str = str(sid)
            if song_id_str in keep_ids:
                flag = "keep"
            elif song_id_str in delete_ids:
                flag = "delete"
            else:
                flag = None
            enriched.append({
                **song,
                "navidrome_id": nav_id,
                "duration_sec": dur,
                "id": song_id_str,
                "flag": flag,
            })
            continue

        # 1. Exact title + artist
        result = await db.execute(
            select(Song.navidrome_id, Song.duration_sec, Song.id)
            .join(Artist, Song.artist_id == Artist.id, isouter=True)
            .where(
                func.lower(Song.title) == title.lower(),
                or_(
                    func.lower(func.coalesce(Song.display_artist, "")) == artist.lower(),
                    func.lower(func.coalesce(Artist.name, "")) == artist.lower(),
                ),
            )
            .limit(1)
        )
        row = result.first()

        # 2. Exact title-only
        if not row:
            result2 = await db.execute(
                select(Song.navidrome_id, Song.duration_sec, Song.id)
                .where(func.lower(Song.title) == title.lower())
                .limit(1)
            )
            row = result2.first()

        # 3a. Partial ILIKE
        if not row and title:
            result3 = await db.execute(
                select(Song.navidrome_id, Song.duration_sec, Song.id)
                .where(Song.title.ilike(f"%{title}%"))
                .limit(1)
            )
            row = result3.first()

        # 3b. Word-level fallback
        if not row and title and artist:
            words = [w for w in title.split() if len(w) > 3]
            if len(words) >= 2:
                pat = f"%{words[0]}%{words[-1]}%"
                result3b = await db.execute(
                    select(Song.navidrome_id, Song.duration_sec, Song.id)
                    .join(Artist, Song.artist_id == Artist.id, isouter=True)
                    .where(
                        Song.title.ilike(pat),
                        or_(
                            func.lower(func.coalesce(Song.display_artist, "")) == artist.lower(),
                            func.lower(func.coalesce(Artist.name, "")) == artist.lower(),
                        ),
                    )
                    .limit(1)
                )
                row = result3b.first()

        # 4. DownloadJob → file_path → Song
        if not row and artist and title:
            job_result = await db.execute(
                select(DownloadJob.file_path)
                .where(
                    DownloadJob.status == "completed",
                    DownloadJob.file_path.isnot(None),
                    func.lower(DownloadJob.artist) == artist.lower(),
                    func.lower(DownloadJob.title) == title.lower(),
                )
                .limit(1)
            )
            job_row = job_result.first()
            if job_row and job_row.file_path:
                rel = job_row.file_path
                if rel.startswith(music_dir + "/"):
                    rel = rel[len(music_dir) + 1:]
                song_result = await db.execute(
                    select(Song.navidrome_id, Song.duration_sec, Song.id)
                    .where(Song.file_path == rel)
                    .limit(1)
                )
                row = song_result.first()

        if row:
            song_id_str = str(row.id)
            # Last action wins: if both keep and delete, keep wins (listen-through overrides skip)
            if song_id_str in keep_ids:
                flag = "keep"
            elif song_id_str in delete_ids:
                flag = "delete"
            else:
                flag = None
            enriched.append({
                **song,
                "navidrome_id": row.navidrome_id,
                "duration_sec": row.duration_sec,
                "id": song_id_str,
                "flag": flag,
            })
        else:
            enriched.append({**song, "status": "downloading", "flag": None})

    return enriched


def _serialize(p: DailyPlaylist) -> dict:
    return {
        "id": str(p.id),
        "profile_id": str(p.profile_id),
        "slot": p.slot,
        "date": str(p.date),
        "songs": p.songs or [],
        "paused_to_tomorrow": p.paused_to_tomorrow,
        "consumed": p.consumed,
        "generated_at": p.generated_at.isoformat() if p.generated_at else None,
    }


def _serialize_summary(p: DailyPlaylist) -> dict:
    songs = p.songs or []
    song_count = len(songs) if isinstance(songs, list) else 0
    return {
        "id": str(p.id),
        "profile_id": str(p.profile_id),
        "slot": p.slot,
        "date": str(p.date),
        "song_count": song_count,
        "paused_to_tomorrow": p.paused_to_tomorrow,
        "generated_at": p.generated_at.isoformat() if p.generated_at else None,
    }
