"""User playlist CRUD — create, rename, delete; add/remove songs; Spotify import."""
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import require_auth
from ..core.database import get_db
from ..models.playlists import UserPlaylist
from ..models.library import Song, Artist

router = APIRouter(prefix="/playlists", tags=["playlists"], dependencies=[Depends(require_auth)])
log = logging.getLogger(__name__)


def _parse_uuid(value: str) -> uuid.UUID:
    """Parse a UUID path/body param → 422 (not 500) on malformed input."""
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(422, "Invalid id")


class PlaylistOut(BaseModel):
    id: str
    name: str
    song_count: int
    created_at: str
    updated_at: str


class PlaylistDetailOut(PlaylistOut):
    songs: list[dict]


class CreatePlaylistRequest(BaseModel):
    name: str


class RenamePlaylistRequest(BaseModel):
    name: str


class AddSongRequest(BaseModel):
    song_id: str


def _summary(p: UserPlaylist) -> PlaylistOut:
    return PlaylistOut(
        id=str(p.id),
        name=p.name,
        song_count=len(p.songs) if p.songs else 0,
        created_at=p.created_at.isoformat(),
        updated_at=p.updated_at.isoformat(),
    )


def _detail(p: UserPlaylist) -> PlaylistDetailOut:
    return PlaylistDetailOut(
        id=str(p.id),
        name=p.name,
        song_count=len(p.songs) if p.songs else 0,
        songs=p.songs or [],
        created_at=p.created_at.isoformat(),
        updated_at=p.updated_at.isoformat(),
    )


@router.get("", response_model=list[PlaylistOut])
async def list_playlists(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(UserPlaylist).order_by(UserPlaylist.updated_at.desc()))
    return [_summary(p) for p in result.scalars().all()]


@router.post("", response_model=PlaylistDetailOut, status_code=201)
async def create_playlist(body: CreatePlaylistRequest, db: AsyncSession = Depends(get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Name required")
    now = datetime.now(timezone.utc)
    p = UserPlaylist(id=uuid.uuid4(), name=name, songs=[], created_at=now, updated_at=now)
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return _detail(p)


@router.get("/{playlist_id}", response_model=PlaylistDetailOut)
async def get_playlist(playlist_id: str, db: AsyncSession = Depends(get_db)):
    p = await db.get(UserPlaylist, uuid.UUID(playlist_id))
    if not p:
        raise HTTPException(404, "Playlist not found")
    return _detail(p)


@router.put("/{playlist_id}", response_model=PlaylistDetailOut)
async def rename_playlist(playlist_id: str, body: RenamePlaylistRequest, db: AsyncSession = Depends(get_db)):
    p = await db.get(UserPlaylist, uuid.UUID(playlist_id))
    if not p:
        raise HTTPException(404, "Playlist not found")
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Name required")
    p.name = name
    p.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(p)
    return _detail(p)


@router.delete("/{playlist_id}", status_code=204)
async def delete_playlist(playlist_id: str, db: AsyncSession = Depends(get_db)):
    p = await db.get(UserPlaylist, uuid.UUID(playlist_id))
    if not p:
        raise HTTPException(404, "Playlist not found")
    await db.delete(p)
    await db.commit()


@router.post("/{playlist_id}/songs", response_model=PlaylistDetailOut)
async def add_song(playlist_id: str, body: AddSongRequest, db: AsyncSession = Depends(get_db)):
    p = await db.get(UserPlaylist, uuid.UUID(playlist_id))
    if not p:
        raise HTTPException(404, "Playlist not found")
    s = await db.get(Song, uuid.UUID(body.song_id))
    if not s:
        raise HTTPException(404, "Song not found")

    artist_name = None
    if s.artist_id:
        ar = await db.get(Artist, s.artist_id)
        artist_name = ar.name if ar else None

    songs = list(p.songs or [])
    if any(song.get("id") == body.song_id for song in songs):
        return _detail(p)  # already present

    songs.append({
        "id": str(s.id),
        "navidrome_id": s.navidrome_id,
        "title": s.title,
        "artist": artist_name or "",
        "duration_sec": s.duration_sec,
    })
    p.songs = songs
    p.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(p)
    return _detail(p)


@router.delete("/{playlist_id}/songs/{song_id}", response_model=PlaylistDetailOut)
async def remove_song(playlist_id: str, song_id: str, db: AsyncSession = Depends(get_db)):
    p = await db.get(UserPlaylist, uuid.UUID(playlist_id))
    if not p:
        raise HTTPException(404, "Playlist not found")
    songs = [s for s in (p.songs or []) if s.get("id") != song_id]
    p.songs = songs
    p.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(p)
    return _detail(p)


class SpotifyImportRequest(BaseModel):
    url: str
    profile_id: Optional[str] = None


class SpotifyImportOut(BaseModel):
    playlist_id: str
    name: str
    track_count: int
    jobs: list[dict]


@router.post("/import-spotify", response_model=SpotifyImportOut, status_code=201)
async def import_spotify_playlist(body: SpotifyImportRequest, db: AsyncSession = Depends(get_db)):
    """Import a Spotify playlist/album by share URL. Creates a UserPlaylist and queues all tracks."""
    from ..services.spotify_import import fetch_spotify_playlist
    from ..services.download_pipeline import request_download

    url = body.url.strip()
    if not url.startswith("https://open.spotify.com/"):
        raise HTTPException(422, "Must be a Spotify URL (https://open.spotify.com/...)")

    try:
        playlist_name, songs = await fetch_spotify_playlist(url)
    except RuntimeError as e:
        raise HTTPException(502, str(e))

    name = (playlist_name or "Imported Playlist").strip() or "Imported Playlist"
    now = datetime.now(timezone.utc)
    playlist = UserPlaylist(id=uuid.uuid4(), name=name, songs=[], created_at=now, updated_at=now)
    db.add(playlist)
    await db.flush()

    jobs = []
    for song in songs:
        artist = song.get("artist") or ""
        title = song.get("name") or ""
        if not artist or not title:
            continue
        profile_uuid = uuid.UUID(body.profile_id) if body.profile_id else None
        job = await request_download(db, "track", artist, title, user_playlist_id=playlist.id,
                                     profile_id=profile_uuid)
        jobs.append({"id": str(job.id), "artist": job.artist, "title": job.title, "status": job.status})

    await db.commit()
    log.info("spotify_import: created playlist '%s' (%d songs, %d queued)", name, len(songs), len(jobs))
    return SpotifyImportOut(
        playlist_id=str(playlist.id),
        name=name,
        track_count=len(jobs),
        jobs=jobs,
    )
