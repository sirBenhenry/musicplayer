import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import require_auth
from ..core.database import get_db
from ..core.config import get_settings
from ..models.events import PendingDeletion, RejectedSong, SongEvent
from ..models.discovery import DailyPlaylist

router = APIRouter(prefix="/playback", tags=["playback"], dependencies=[Depends(require_auth)])
settings = get_settings()


class ProgressBody(BaseModel):
    song_id: uuid.UUID
    playlist_id: Optional[uuid.UUID] = None
    progress_pct: float


class SkipBody(BaseModel):
    song_id: uuid.UUID
    playlist_id: Optional[uuid.UUID] = None
    progress_pct: float


class ListenThroughBody(BaseModel):
    song_id: uuid.UUID
    playlist_id: Optional[uuid.UUID] = None


async def _is_daily(db: AsyncSession, playlist_id: Optional[uuid.UUID]) -> bool:
    if not playlist_id:
        return False
    pl = await db.get(DailyPlaylist, playlist_id)
    return pl is not None


@router.post("/progress", status_code=204)
async def report_progress(body: ProgressBody, db: Annotated[AsyncSession, Depends(get_db)]):
    """Periodic progress ping. At >= SKIP_THRESHOLD, auto-trigger listen_through."""
    if body.progress_pct >= settings.SKIP_THRESHOLD and await _is_daily(db, body.playlist_id):
        existing = await db.execute(
            select(SongEvent).where(
                SongEvent.song_id == body.song_id,
                SongEvent.playlist_id == body.playlist_id,
                SongEvent.event_type == "listen_through",
            )
        )
        if not existing.scalar_one_or_none():
            db.add(SongEvent(
                song_id=body.song_id,
                playlist_id=body.playlist_id,
                event_type="listen_through",
                progress_pct=body.progress_pct,
            ))
            # Remove from pending deletions if it was there
            pd_res = await db.execute(
                select(PendingDeletion).where(
                    PendingDeletion.song_id == body.song_id,
                    PendingDeletion.rescued == False,  # noqa: E712
                )
            )
            pd = pd_res.scalar_one_or_none()
            if pd:
                pd.rescued = True
            await db.commit()


@router.post("/skip", status_code=204)
async def skip_song(body: SkipBody, db: Annotated[AsyncSession, Depends(get_db)]):
    if not await _is_daily(db, body.playlist_id):
        return  # skip mechanic only applies to daily playlists

    db.add(SongEvent(
        song_id=body.song_id,
        playlist_id=body.playlist_id,
        event_type="skip",
        progress_pct=body.progress_pct,
    ))

    existing_pd = await db.execute(
        select(PendingDeletion).where(PendingDeletion.song_id == body.song_id)
    )
    if not existing_pd.scalar_one_or_none():
        db.add(PendingDeletion(song_id=body.song_id, playlist_id=body.playlist_id))

    # Add to rejected list (expires 6 months from now)
    from ..models.library import Song
    song = await db.get(Song, body.song_id)
    if song:
        from ..models.library import Artist
        artist = await db.get(Artist, song.artist_id) if song.artist_id else None
        db.add(RejectedSong(
            artist=artist.name if artist else "",
            title=song.title,
            rejected_at=datetime.now(timezone.utc),
            expires_at=datetime.now(timezone.utc) + timedelta(days=182),
        ))

    await db.commit()


@router.post("/listen-through", status_code=204)
async def listen_through(body: ListenThroughBody, db: Annotated[AsyncSession, Depends(get_db)]):
    if not await _is_daily(db, body.playlist_id):
        return

    existing = await db.execute(
        select(SongEvent).where(
            SongEvent.song_id == body.song_id,
            SongEvent.playlist_id == body.playlist_id,
            SongEvent.event_type == "listen_through",
        )
    )
    if not existing.scalar_one_or_none():
        db.add(SongEvent(
            song_id=body.song_id,
            playlist_id=body.playlist_id,
            event_type="listen_through",
            progress_pct=1.0,
        ))
        # Rescue from pending deletions if it was there
        pd_res = await db.execute(
            select(PendingDeletion).where(PendingDeletion.song_id == body.song_id)
        )
        pd = pd_res.scalar_one_or_none()
        if pd:
            pd.rescued = True

    # Scrobble to ListenBrainz (fire and forget)
    import asyncio
    from ..models.library import Song, Artist
    song = await db.get(Song, body.song_id)
    if song:
        artist = await db.get(Artist, song.artist_id) if song.artist_id else None
        asyncio.create_task(_scrobble(song.title, artist.name if artist else ""))

    await db.commit()


async def _scrobble(title: str, artist: str) -> None:
    try:
        from ..services.listenbrainz import submit_listen
        await submit_listen(title, artist)
    except Exception:
        pass
