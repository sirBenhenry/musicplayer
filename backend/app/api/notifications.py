"""Notification center endpoints."""
import os
import uuid
import logging
from datetime import datetime, timezone
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import require_auth
from ..core.database import get_db
from ..models.events import UserNotification
from ..core.database import AsyncSessionLocal

log = logging.getLogger(__name__)
router = APIRouter(tags=["notifications"], dependencies=[Depends(require_auth)])


class NotificationOut(BaseModel):
    id: uuid.UUID
    type: str
    download_job_id: Optional[uuid.UUID]
    message: str
    dismissed: bool
    action_taken: Optional[str]
    data: Optional[Any]
    created_at: datetime
    dismissed_at: Optional[datetime]
    model_config = {"from_attributes": True}


class ActionBody(BaseModel):
    accept: bool
    profile_id: Optional[str] = None        # UUID str, or "new"
    new_profile_name: Optional[str] = None  # used when profile_id == "new"


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


@router.post("/notifications/{notif_id}/action", status_code=200)
async def notification_action(
    notif_id: uuid.UUID,
    body: ActionBody,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Accept or dismiss a genre_prompt or artist_prompt notification.

    genre_prompt + accept: assign staged songs to chosen/new profile
    genre_prompt + !accept: delete staged songs
    artist_prompt + accept: follow or add artist, assign songs to profile
    artist_prompt + !accept: delete staged songs
    """
    notif = await db.get(UserNotification, notif_id)
    if not notif:
        raise HTTPException(404, "Notification not found")
    if notif.dismissed:
        raise HTTPException(409, "Notification already dismissed")
    if notif.type not in ("genre_prompt", "artist_prompt"):
        raise HTTPException(400, f"Action not supported for notification type: {notif.type}")

    data = notif.data or {}
    song_ids: list[str] = data.get("song_ids", [])
    playlist_profile_id: str | None = data.get("playlist_profile_id")

    result_details: dict = {}

    if notif.type == "genre_prompt":
        if body.accept:
            target_profile_id = await _resolve_or_create_profile(
                db, body.profile_id, body.new_profile_name or data.get("genre_name", "Discoveries")
            )
            assigned = await _assign_songs(db, song_ids, target_profile_id)
            result_details = {"assigned": assigned, "profile_id": str(target_profile_id)}
            notif.action_taken = "confirmed"
        else:
            deleted = await _delete_staged_songs(db, song_ids)
            result_details = {"deleted": deleted}
            notif.action_taken = "dismissed"

    elif notif.type == "artist_prompt":
        if body.accept:
            artist_action = data.get("action", "add")
            artist_name = data.get("artist_name", "")
            artist_mb_id = data.get("artist_mb_id")

            # Assign songs to the playlist's profile first
            target_pid = playlist_profile_id
            if target_pid:
                await _assign_songs(db, song_ids, target_pid)

            # Follow/add the artist — best-effort, don't fail entire action if Lidarr is down
            artist_result = "skipped"
            try:
                from ..models.library import Artist as ArtistModel
                artist_q = await db.execute(
                    select(ArtistModel).where(ArtistModel.name == artist_name).limit(1)
                )
                artist = artist_q.scalar_one_or_none()
                if artist:
                    artist.followed = True
                    if artist_action == "follow" and artist_mb_id:
                        try:
                            from ..services.lidarr import add_artist_to_lidarr
                            lidarr_id = await add_artist_to_lidarr(artist_name, artist_mb_id)
                            if lidarr_id:
                                artist.lidarr_id = lidarr_id
                                artist_result = "followed"
                            else:
                                artist_result = "added"
                        except Exception as e:
                            log.warning("notification_action: Lidarr failed for %s: %s", artist_name, e)
                            artist_result = "added_no_lidarr"
                    else:
                        artist_result = "added"
            except Exception as e:
                log.error("notification_action: artist update failed for %s: %s", artist_name, e)

            result_details = {"artist_result": artist_result, "action": artist_action}
            notif.action_taken = "confirmed"
        else:
            deleted = await _delete_staged_songs(db, song_ids)
            result_details = {"deleted": deleted}
            notif.action_taken = "dismissed"

    notif.dismissed = True
    notif.dismissed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "ok", **result_details}


# ── helpers ───────────────────────────────────────────────────────────────────

async def _resolve_or_create_profile(db: AsyncSession, profile_id: str | None, name: str) -> uuid.UUID:
    from ..models.profile import Profile

    if profile_id and profile_id != "new":
        try:
            pid = uuid.UUID(profile_id)
            p = await db.get(Profile, pid)
            if p:
                return p.id
        except ValueError:
            pass

    # Create new profile
    new_profile = Profile(
        id=uuid.uuid4(),
        name=name,
        glyph="🎲",
        is_catchall=False,
        daily_auto_generate=False,
    )
    db.add(new_profile)
    await db.flush()
    log.info("notification_action: created profile '%s'", name)
    return new_profile.id


async def _assign_songs(db: AsyncSession, song_ids: list[str], profile_id: str | uuid.UUID) -> int:
    from ..models.library import Song
    pid = uuid.UUID(str(profile_id)) if not isinstance(profile_id, uuid.UUID) else profile_id
    assigned = 0
    for sid_str in song_ids:
        try:
            sid = uuid.UUID(sid_str)
            song = await db.get(Song, sid)
            if song:
                song.profile_id = pid
                song.is_staged = False
                song.needs_profile_assignment = False
                assigned += 1
        except Exception as e:
            log.warning("_assign_songs: failed for song %s: %s", sid_str, e)
    return assigned


async def _delete_staged_songs(db: AsyncSession, song_ids: list[str]) -> int:
    from ..models.library import Song
    from ..core.config import get_settings
    music_dir = get_settings().MUSIC_DIR
    deleted = 0
    for sid_str in song_ids:
        try:
            sid = uuid.UUID(sid_str)
            song = await db.get(Song, sid)
            if not song:
                continue
            if not song.is_staged:
                log.warning("_delete_staged_songs: song %s is not staged, skipping", sid_str)
                continue
            if song.file_path:
                abs_path = song.file_path if song.file_path.startswith("/") else os.path.join(music_dir, song.file_path)
                if os.path.exists(abs_path):
                    try:
                        os.remove(abs_path)
                    except OSError as e:
                        log.error("_delete_staged_songs: file delete failed %s: %s", abs_path, e)
            await db.delete(song)
            deleted += 1
        except Exception as e:
            log.warning("_delete_staged_songs: failed for song %s: %s", sid_str, e)
    return deleted
