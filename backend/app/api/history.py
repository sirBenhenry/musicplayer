"""Playback/discovery history API."""
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import require_auth
from ..core.database import get_db
from ..discovery.downloader import queue_downloads
from ..models.discovery import PlaylistHistory

router = APIRouter(prefix="/history", tags=["history"])
log = logging.getLogger(__name__)


@router.get("")
async def get_history(
    limit: int = 30,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    result = await db.execute(
        select(PlaylistHistory)
        .order_by(PlaylistHistory.created_at.desc())
        .limit(limit)
    )
    rows = result.scalars().all()
    return [_serialize(r) for r in rows]


@router.post("/{history_id}/redownload")
async def redownload(
    history_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    row = await db.get(PlaylistHistory, history_id)
    if not row:
        raise HTTPException(404, "History entry not found")
    tracklist = row.tracklist or []
    asyncio.create_task(queue_downloads(tracklist))
    return {"queued": len(tracklist)}


def _serialize(r: PlaylistHistory) -> dict:
    return {
        "id": str(r.id),
        "slot": r.slot,
        "date": str(r.date),
        "genre": r.genre,
        "tracklist": r.tracklist or [],
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }
