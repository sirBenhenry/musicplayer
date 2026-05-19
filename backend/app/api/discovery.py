"""Discovery API — daily playlists, pause, manual trigger."""
import asyncio
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import require_auth
from ..core.database import get_db
from ..discovery.pipeline import generate_for_profile
from ..models.discovery import DailyPlaylist
from ..models.profile import Profile

router = APIRouter(prefix="/discovery", tags=["discovery"])
log = logging.getLogger(__name__)


@router.get("/today")
async def get_today(
    profile_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    q = select(DailyPlaylist).where(DailyPlaylist.date == date.today())
    if profile_id:
        q = q.where(DailyPlaylist.profile_id == profile_id)
    result = await db.execute(q)
    playlists = result.scalars().all()
    return [_serialize(p) for p in playlists]


@router.get("/playlists/{playlist_id}")
async def get_playlist(
    playlist_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    p = await db.get(DailyPlaylist, playlist_id)
    if not p:
        raise HTTPException(404, "Playlist not found")
    return _serialize(p)


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
async def trigger_generate(
    profile_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    profile = await db.get(Profile, profile_id)
    if not profile:
        raise HTTPException(404, "Profile not found")
    asyncio.create_task(generate_for_profile(profile_id))
    return {"status": "queued"}


def _serialize(p: DailyPlaylist) -> dict:
    return {
        "id": str(p.id),
        "profile_id": str(p.profile_id),
        "slot": p.slot,
        "date": str(p.date),
        "songs": p.songs or [],
        "paused_to_tomorrow": p.paused_to_tomorrow,
        "generated_at": p.generated_at.isoformat() if p.generated_at else None,
    }
