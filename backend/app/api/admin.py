"""Admin endpoints — manual sync, analysis trigger."""
import asyncio
import asyncio
import logging

from fastapi import APIRouter, Depends

from ..core.auth import require_auth
from ..jobs.library_sync import run_library_sync
from ..services.essentia_svc import analyse_pending_songs

router = APIRouter(prefix="/admin", tags=["admin"])
log = logging.getLogger(__name__)


@router.post("/sync")
async def trigger_sync(_: str = Depends(require_auth)):
    asyncio.create_task(run_library_sync())
    return {"status": "sync queued"}


@router.post("/analyse")
async def trigger_analyse(_: str = Depends(require_auth)):
    asyncio.create_task(analyse_pending_songs())
    return {"status": "analysis queued"}
