import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import require_auth
from ..core.database import get_db
from ..models.library import Song
from ..models.profile import Profile

router = APIRouter(prefix="/profiles", tags=["profiles"], dependencies=[Depends(require_auth)])


class ProfileIn(BaseModel):
    name: str
    description: Optional[str] = None
    glyph: Optional[str] = None
    hue: Optional[int] = None
    is_catchall: bool = False
    daily_auto_generate: bool = False


class ProfileOut(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str]
    glyph: Optional[str]
    hue: Optional[int]
    is_catchall: bool
    daily_auto_generate: bool
    song_count: int = 0
    model_config = {"from_attributes": True}


@router.get("", response_model=list[ProfileOut])
async def list_profiles(db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(select(Profile))
    profiles = result.scalars().all()
    out = []
    for p in profiles:
        count_res = await db.execute(
            select(Song).where(Song.profile_id == p.id)
        )
        count = len(count_res.scalars().all())
        out.append(ProfileOut(
            id=p.id, name=p.name, description=p.description,
            glyph=p.glyph, hue=p.hue, is_catchall=p.is_catchall,
            daily_auto_generate=p.daily_auto_generate, song_count=count,
        ))
    return out


@router.post("", response_model=ProfileOut, status_code=201)
async def create_profile(body: ProfileIn, db: Annotated[AsyncSession, Depends(get_db)]):
    if body.is_catchall:
        existing = await db.execute(select(Profile).where(Profile.is_catchall == True))  # noqa: E712
        if existing.scalar_one_or_none():
            raise HTTPException(400, "A catchall profile already exists")
    p = Profile(**body.model_dump())
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return ProfileOut.model_validate(p)


@router.put("/{profile_id}", response_model=ProfileOut)
async def update_profile(
    profile_id: uuid.UUID, body: ProfileIn,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    p = await db.get(Profile, profile_id)
    if not p:
        raise HTTPException(404, "Profile not found")
    for field, value in body.model_dump().items():
        setattr(p, field, value)
    await db.commit()
    await db.refresh(p)
    return ProfileOut.model_validate(p)


@router.delete("/{profile_id}", status_code=204)
async def delete_profile(profile_id: uuid.UUID, db: Annotated[AsyncSession, Depends(get_db)]):
    p = await db.get(Profile, profile_id)
    if not p:
        raise HTTPException(404, "Profile not found")
    if p.is_catchall:
        raise HTTPException(400, "Cannot delete the catchall profile")
    await db.delete(p)
    await db.commit()


class AssignRequest(BaseModel):
    profile_id: uuid.UUID


@router.post("/../songs/{song_id}/assign", status_code=204, include_in_schema=False)
async def _unused():
    pass


# Song assignment lives here but path is on /songs — mounted in main via library router
# We expose it through a separate helper used by the library router
async def assign_song_profile(song_id: uuid.UUID, profile_id: uuid.UUID, db: AsyncSession) -> None:
    song = await db.get(Song, song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    profile = await db.get(Profile, profile_id)
    if not profile:
        raise HTTPException(404, "Profile not found")
    song.profile_id = profile_id
    song.needs_profile_assignment = False
    await db.commit()
