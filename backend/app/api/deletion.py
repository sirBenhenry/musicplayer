import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import require_auth
from ..core.database import get_db
from ..models.events import PendingDeletion
from ..models.library import Song

router = APIRouter(prefix="/deletion", tags=["deletion"], dependencies=[Depends(require_auth)])


class PendingItem(BaseModel):
    song_id: uuid.UUID
    title: str
    artist_name: str
    marked_at: str


@router.get("/pending", response_model=list[PendingItem])
async def get_pending(db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(
        select(PendingDeletion).where(PendingDeletion.rescued == False)  # noqa: E712
    )
    items = result.scalars().all()
    out = []
    for pd in items:
        song = await db.get(Song, pd.song_id)
        if not song:
            continue
        from ..models.library import Artist
        artist = await db.get(Artist, song.artist_id) if song.artist_id else None
        out.append(PendingItem(
            song_id=pd.song_id,
            title=song.title,
            artist_name=artist.name if artist else "",
            marked_at=pd.marked_at.isoformat(),
        ))
    return out


@router.post("/{song_id}/rescue", status_code=204)
async def rescue_song(song_id: uuid.UUID, db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(
        select(PendingDeletion).where(
            PendingDeletion.song_id == song_id,
            PendingDeletion.rescued == False,  # noqa: E712
        )
    )
    pd = result.scalar_one_or_none()
    if not pd:
        raise HTTPException(404, "Not in pending deletions")
    pd.rescued = True
    await db.commit()


@router.post("/{song_id}/mark", status_code=204)
async def mark_for_deletion(song_id: uuid.UUID, db: Annotated[AsyncSession, Depends(get_db)]):
    song = await db.get(Song, song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    existing = await db.execute(
        select(PendingDeletion).where(PendingDeletion.song_id == song_id)
    )
    if existing.scalar_one_or_none():
        return  # already marked
    db.add(PendingDeletion(song_id=song_id))
    await db.commit()
