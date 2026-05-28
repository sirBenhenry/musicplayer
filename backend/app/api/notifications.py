"""Notification center endpoints."""
import uuid
import logging
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import require_auth
from ..core.database import get_db
from ..models.events import UserNotification

log = logging.getLogger(__name__)
router = APIRouter(tags=["notifications"], dependencies=[Depends(require_auth)])


class NotificationOut(BaseModel):
    id: uuid.UUID
    type: str
    download_job_id: Optional[uuid.UUID]
    message: str
    dismissed: bool
    action_taken: Optional[str]
    created_at: datetime
    dismissed_at: Optional[datetime]
    model_config = {"from_attributes": True}


@router.get("/notifications", response_model=list[NotificationOut])
async def list_notifications(db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(
        select(UserNotification)
        .where(UserNotification.dismissed == False)
        .order_by(UserNotification.created_at.desc())
    )
    return result.scalars().all()


@router.get("/notifications/count")
async def notification_count(db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(
        select(UserNotification).where(UserNotification.dismissed == False)
    )
    return {"count": len(result.scalars().all())}


@router.post("/notifications/{notif_id}/dismiss", status_code=200)
async def dismiss_notification(
    notif_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    notif = await db.get(UserNotification, notif_id)
    if not notif:
        raise HTTPException(404, "Notification not found")
    notif.dismissed = True
    notif.dismissed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "ok"}


@router.post("/notifications/dismiss-all", status_code=200)
async def dismiss_all_notifications(db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(
        select(UserNotification).where(UserNotification.dismissed == False)
    )
    now = datetime.now(timezone.utc)
    count = 0
    for notif in result.scalars().all():
        notif.dismissed = True
        notif.dismissed_at = now
        count += 1
    await db.commit()
    return {"status": "ok", "dismissed": count}
