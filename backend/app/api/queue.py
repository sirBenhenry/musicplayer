"""In-memory session queue + auto-radio next-song endpoint."""
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import require_auth
from ..core.database import get_db
from ..models.library import Song
from ..services.navidrome import stream_url

router = APIRouter(prefix="/queue", tags=["queue"])
log = logging.getLogger(__name__)

# Single-user in-memory queue
_queue: list[dict] = []
_current_index: int = 0


class AppendBody(BaseModel):
    song_id: str


class NextBody(BaseModel):
    song_id: str


class ReorderBody(BaseModel):
    from_index: int
    to_index: int


@router.get("")
async def get_queue(_: str = Depends(require_auth)):
    return {"items": _queue, "current_index": _current_index}


@router.post("/append")
async def append(
    body: AppendBody,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    song = await db.get(Song, body.song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    _queue.append(_song_dict(song))
    return {"queue_length": len(_queue)}


@router.post("/next")
async def insert_next(
    body: NextBody,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    global _current_index
    song = await db.get(Song, body.song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    insert_at = _current_index + 1
    _queue.insert(insert_at, _song_dict(song))
    return {"inserted_at": insert_at}


@router.delete("/{index}")
async def remove_item(index: int, _: str = Depends(require_auth)):
    global _current_index
    if index < 0 or index >= len(_queue):
        raise HTTPException(400, "Index out of range")
    _queue.pop(index)
    if index < _current_index:
        _current_index = max(0, _current_index - 1)
    return {"queue_length": len(_queue)}


@router.put("/reorder")
async def reorder(body: ReorderBody, _: str = Depends(require_auth)):
    global _current_index
    if body.from_index < 0 or body.from_index >= len(_queue):
        raise HTTPException(400, "from_index out of range")
    if body.to_index < 0 or body.to_index >= len(_queue):
        raise HTTPException(400, "to_index out of range")
    item = _queue.pop(body.from_index)
    _queue.insert(body.to_index, item)
    return {"queue_length": len(_queue)}


@router.get("/auto-radio")
async def auto_radio(
    song_id: str,
    profile_id: str | None = None,
    scope: str = "profile",
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    """Return next song by vector similarity. Falls back to random if no vectors."""
    song = await db.get(Song, song_id)
    if not song or song.feature_vector is None:
        # Fallback: random song from profile or library
        q = "SELECT id FROM songs WHERE id != :sid"
        params: dict[str, Any] = {"sid": song_id}
        if scope == "profile" and profile_id:
            q += " AND profile_id = :pid"
            params["pid"] = profile_id
        q += " AND analysed_at IS NOT NULL ORDER BY RANDOM() LIMIT 1"
        result = await db.execute(text(q), params)
        row = result.fetchone()
        if not row:
            raise HTTPException(404, "No songs available")
        next_song = await db.get(Song, row[0])
    else:
        q = (
            "SELECT id FROM songs "
            "WHERE id != :sid AND analysed_at IS NOT NULL AND feature_vector IS NOT NULL"
        )
        params = {"sid": song_id, "vec": song.feature_vector}
        if scope == "profile" and profile_id:
            q += " AND profile_id = :pid"
            params["pid"] = profile_id
        q += " ORDER BY feature_vector <=> :vec LIMIT 1"
        result = await db.execute(text(q), params)
        row = result.fetchone()
        if not row:
            raise HTTPException(404, "No similar songs found")
        next_song = await db.get(Song, row[0])

    if not next_song:
        raise HTTPException(404, "Song not found")

    return {**_song_dict(next_song), "stream_url": stream_url(next_song.navidrome_id)}


def _song_dict(song: Song) -> dict:
    return {
        "id": str(song.id),
        "navidrome_id": song.navidrome_id,
        "title": song.title,
        "artist_id": str(song.artist_id) if song.artist_id else None,
        "album_id": str(song.album_id) if song.album_id else None,
        "duration_sec": song.duration_sec,
    }
