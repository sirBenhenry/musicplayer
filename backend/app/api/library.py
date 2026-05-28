import logging
import uuid
from typing import Annotated, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

log = logging.getLogger(__name__)
from pydantic import BaseModel
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import require_auth
from ..core.database import get_db
from ..models.library import Artist, Album, Song
from ..services import navidrome

router = APIRouter(tags=["library"], dependencies=[Depends(require_auth)])

# Unauthenticated router for media proxy endpoints (stream + cover art)
stream_router = APIRouter(tags=["stream"])


@stream_router.get("/stream/{navidrome_id}")
async def stream_audio(navidrome_id: str):
    from fastapi import HTTPException
    url = navidrome.stream_url(navidrome_id)
    client = httpx.AsyncClient(timeout=None)
    r = await client.send(client.build_request("GET", url), stream=True)
    content_type = r.headers.get("content-type", "")

    # Navidrome returns application/json for invalid IDs (Subsonic error envelope).
    # Passing that to expo-av causes silent playback failure on Android.
    if not content_type.startswith(("audio/", "video/", "application/octet-stream")):
        await r.aclose()
        await client.aclose()
        raise HTTPException(status_code=404, detail=f"Song not streamable (navidrome_id={navidrome_id}, content-type={content_type!r})")

    async def _gen():
        try:
            async for chunk in r.aiter_bytes(chunk_size=65536):
                yield chunk
        finally:
            await r.aclose()
            await client.aclose()

    return StreamingResponse(_gen(), media_type=content_type)


@stream_router.get("/cover/{navidrome_id}")
async def cover_art(navidrome_id: str):
    url = navidrome.cover_art_url(navidrome_id)

    async def _gen():
        async with httpx.AsyncClient(timeout=30) as client:
            async with client.stream("GET", url) as r:
                async for chunk in r.aiter_bytes(chunk_size=32768):
                    yield chunk

    return StreamingResponse(_gen(), media_type="image/jpeg")


# ── Schemas ──────────────────────────────────────────────────────────────────

class ArtistOut(BaseModel):
    id: uuid.UUID
    navidrome_id: str
    name: str
    followed: bool
    monitored: bool  # True = has Lidarr entry (full monitoring); False = added without monitoring
    new_release: bool
    model_config = {"from_attributes": True}


class AlbumOut(BaseModel):
    id: uuid.UUID
    navidrome_id: str
    title: str
    year: Optional[int]
    cover_url: Optional[str]
    model_config = {"from_attributes": True}


class SongOut(BaseModel):
    id: uuid.UUID
    navidrome_id: str
    title: str
    title_romanized: Optional[str] = None
    duration_sec: Optional[int]
    profile_id: Optional[uuid.UUID]
    needs_profile_assignment: bool
    artist_name: Optional[str] = None
    display_artist: Optional[str] = None
    album_title: Optional[str] = None
    model_config = {"from_attributes": True}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/songs", response_model=list[SongOut])
async def list_songs(
    db: Annotated[AsyncSession, Depends(get_db)],
    profile: Optional[uuid.UUID] = None,
    artist: Optional[uuid.UUID] = None,
    search: Optional[str] = None,
    unassigned: bool = False,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=5000),
):
    q = select(Song)
    if profile:
        from ..models.profile import Profile as _Profile
        prof = await db.get(_Profile, profile)
        if prof and prof.is_catchall:
            pass  # catchall: show all songs, no filter
        else:
            # Specific profile: show only explicitly assigned songs (NULL = unassigned, catchall-only)
            q = q.where(Song.profile_id == profile)
    if artist:
        q = q.where(Song.artist_id == artist)
    if unassigned:
        q = q.where(Song.needs_profile_assignment == True)  # noqa: E712
    if search:
        q = q.where(Song.title.ilike(f"%{search}%"))
    q = q.order_by(Song.title).offset((page - 1) * limit).limit(limit)
    result = await db.execute(q)
    songs = result.scalars().all()

    out = []
    for s in songs:
        artist_name = None
        album_title = None
        if s.artist_id:
            ar = await db.get(Artist, s.artist_id)
            artist_name = ar.name if ar else None
        if s.album_id:
            al = await db.get(Album, s.album_id)
            album_title = al.title if al else None
        out.append(SongOut(
            id=s.id, navidrome_id=s.navidrome_id, title=s.title,
            title_romanized=s.title_romanized,
            duration_sec=s.duration_sec, profile_id=s.profile_id,
            needs_profile_assignment=s.needs_profile_assignment,
            artist_name=artist_name,
            display_artist=s.display_artist,
            album_title=album_title,
        ))
    return out


@router.get("/songs/{song_id}", response_model=SongOut)
async def get_song(song_id: uuid.UUID, db: Annotated[AsyncSession, Depends(get_db)]):
    s = await db.get(Song, song_id)
    if not s:
        raise HTTPException(404, "Song not found")
    return SongOut.model_validate(s)


@router.delete("/songs/{song_id}", status_code=204)
async def delete_song(song_id: uuid.UUID, db: Annotated[AsyncSession, Depends(get_db)]):
    import asyncio, os
    s = await db.get(Song, song_id)
    if not s:
        raise HTTPException(404, "Song not found")
    if s.file_path:
        from ..core.config import get_settings
        music_dir = get_settings().MUSIC_DIR
        abs_path = s.file_path if s.file_path.startswith('/') else os.path.join(music_dir, s.file_path)
        if os.path.exists(abs_path):
            try:
                os.remove(abs_path)
            except Exception as e:
                log.warning("delete_song: file remove failed %s: %s", abs_path, e)
    await db.delete(s)
    await db.commit()
    asyncio.create_task(navidrome.trigger_scan())


class SongProfileUpdate(BaseModel):
    profile_id: Optional[str] = None


@router.patch("/songs/{song_id}/profile", status_code=200)
async def set_song_profile(
    song_id: uuid.UUID,
    body: SongProfileUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    s = await db.get(Song, song_id)
    if not s:
        raise HTTPException(404, "Song not found")
    s.profile_id = uuid.UUID(body.profile_id) if body.profile_id else None
    s.needs_profile_assignment = False
    await db.commit()
    return {"ok": True}


class ArtistSearchResult(BaseModel):
    mbid: str
    name: str
    genres: list[str] = []
    image_url: Optional[str] = None
    overview: Optional[str] = None
    disambiguation: Optional[str] = None  # e.g. "US pop singer" vs "UK rapper"
    country: Optional[str] = None
    begin_year: Optional[int] = None
    ended: bool = False


class ImportArtistRequest(BaseModel):
    mbid: str
    name: str
    follow: bool = False
    download_recordings: bool = False


class TrackSearchResult(BaseModel):
    title: str
    artist: str
    album: str = ""
    mb_recording_id: str = ""


class DownloadTrackRequest(BaseModel):
    title: str
    artist: str
    mb_recording_id: Optional[str] = None


class DownloadAllRequest(BaseModel):
    mbid: str
    name: str


@router.get("/tracks/search", response_model=list[TrackSearchResult])
async def search_tracks_endpoint(
    q: str = Query(..., min_length=2),
    search_filter: str = Query("all"),
):
    """Search for individual tracks via MusicBrainz recordings."""
    from ..services.musicbrainz import search_recordings
    results = await search_recordings(q, limit=30, search_filter=search_filter)
    return [TrackSearchResult(**r) for r in results[:30]]


@router.post("/tracks/download", status_code=202)
async def download_track(body: DownloadTrackRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    """Queue download of a single track via the multi-source pipeline."""
    from ..services.download_pipeline import request_download
    job = await request_download(
        db, item_type="track", artist=body.artist, title=body.title,
        mb_recording_id=body.mb_recording_id,
    )
    return {"status": "queued", "job_id": str(job.id), "message": f"Searching for {body.artist} — {body.title}"}


@router.post("/artists/{artist_id}/download-all", status_code=202)
async def download_all_artist(
    artist_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Queue every individual recording for an artist via MusicBrainz, including features."""
    from ..services import musicbrainz
    from ..services.download_pipeline import request_download
    a = await db.get(Artist, artist_id)
    if not a:
        raise HTTPException(404, "Artist not found")
    mbid = getattr(a, 'musicbrainz_id', None)
    if not mbid:
        raise HTTPException(422, "Artist has no MusicBrainz ID — add via Discover tab first")
    recordings = await musicbrainz.get_artist_recordings(mbid)
    if not recordings:
        raise HTTPException(422, f"No recordings found on MusicBrainz for {a.name}")
    queued = 0
    for rec in recordings:
        title = rec.get("title", "").strip()
        mb_recording_id = rec.get("mb_recording_id")
        if title:
            await request_download(
                db,
                item_type="track",
                artist=a.name,
                title=title,
                mb_recording_id=mb_recording_id,
            )
            queued += 1
    return {"status": "queued", "count": queued, "message": f"Queued {queued} recordings for {a.name}"}


@router.get("/artists/search", response_model=list[ArtistSearchResult])
async def search_new_artists(q: str = Query(..., min_length=2)):
    from ..services.lidarr import search_artists
    results = await search_artists(q)
    out = []
    for r in results[:20]:
        raw_genres = r.get("genres", [])
        genres = [g if isinstance(g, str) else g.get("name", "") for g in raw_genres]
        images = r.get("images", [])
        # prefer poster, fall back to banner or any image
        image_url = (
            next((i.get("url") for i in images if i.get("coverType") == "poster"), None)
            or next((i.get("url") for i in images if i.get("url")), None)
        )
        disambiguation = r.get("disambiguation") or None
        artist_type = r.get("artistType", "")  # Person|Group|Orchestra|Choir|Character
        ended = r.get("status", "") == "ended"
        # Prepend artist_type to disambiguation if it adds info (e.g. "Orchestra")
        if artist_type and artist_type not in ("Person", "Group", "") and not disambiguation:
            disambiguation = artist_type

        out.append(ArtistSearchResult(
            mbid=r.get("foreignArtistId", ""),
            name=r.get("artistName", ""),
            genres=genres,
            image_url=image_url,
            overview=r.get("overview", ""),
            disambiguation=disambiguation,
            country=None,
            begin_year=None,
            ended=ended,
        ))
    return out


@router.post("/artists/import", status_code=202)
async def import_artist(
    body: ImportArtistRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    from ..services.lidarr import add_artist_to_lidarr
    from ..services import musicbrainz
    from ..services.download_pipeline import request_download
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from datetime import datetime, timezone

    # Add to Lidarr for release monitoring
    lidarr_id = await add_artist_to_lidarr(body.name, body.mbid)

    queued = 0

    if body.download_recordings:
        # Queue every individual recording via MusicBrainz
        recordings = await musicbrainz.get_artist_recordings(body.mbid)
        for rec in (recordings or []):
            title = rec.get("title", "").strip()
            mb_recording_id = rec.get("mb_recording_id")
            if title:
                await request_download(
                    db, item_type="track", artist=body.name, title=title,
                    mb_recording_id=mb_recording_id,
                )
                queued += 1
    # "Add to library" (body.follow=True, no download_recordings) = Lidarr monitoring only,
    # no album queue. User downloads songs individually from the Songs search tab.

    if body.follow:
        # Upsert a placeholder Artist record so "Following" shows immediately.
        # Library sync will merge this into the real record (matched by name) after Navidrome picks it up.
        placeholder_id = f"mb:{body.mbid}"
        stmt = pg_insert(Artist).values(
            navidrome_id=placeholder_id,
            name=body.name,
            musicbrainz_id=body.mbid,
            followed=True,
            lidarr_id=lidarr_id,
            added_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        ).on_conflict_do_update(
            index_elements=["navidrome_id"],
            set_={"followed": True, "lidarr_id": lidarr_id, "updated_at": datetime.now(timezone.utc)},
        )
        await db.execute(stmt)
        await db.commit()

    return {
        "status": "queued",
        "lidarr_id": lidarr_id,
        "count": queued,
        "message": f"Queued {queued} {'recordings' if body.download_recordings else 'releases'} for {body.name}",
    }


@router.get("/artists", response_model=list[ArtistOut])
async def list_artists(
    db: Annotated[AsyncSession, Depends(get_db)],
    followed: Optional[bool] = None,
    profile_id: Optional[uuid.UUID] = None,
):
    from sqlalchemy import exists as sa_exists
    q = select(Artist)
    if followed is not None:
        q = q.where(Artist.followed == followed)
    if profile_id is not None:
        q = q.where(
            sa_exists().where(
                (Song.artist_id == Artist.id) & (Song.profile_id == profile_id)
            )
        )
    q = q.order_by(Artist.name)
    result = await db.execute(q)
    artists = result.scalars().all()
    return [
        ArtistOut(
            id=a.id, navidrome_id=a.navidrome_id, name=a.name,
            followed=a.followed, monitored=a.lidarr_id is not None,
            new_release=a.new_release_flagged_at is not None,
        )
        for a in artists
    ]


@router.get("/artists/{artist_id}", response_model=ArtistOut)
async def get_artist(artist_id: uuid.UUID, db: Annotated[AsyncSession, Depends(get_db)]):
    a = await db.get(Artist, artist_id)
    if not a:
        raise HTTPException(404, "Artist not found")
    return ArtistOut(id=a.id, navidrome_id=a.navidrome_id, name=a.name,
                     followed=a.followed, new_release=a.new_release_flagged_at is not None)


@router.post("/artists/{artist_id}/add", status_code=204)
async def add_artist(
    artist_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    a = await db.get(Artist, artist_id)
    if not a:
        raise HTTPException(404, "Artist not found")
    a.followed = True
    await db.commit()


@router.post("/artists/{artist_id}/follow", status_code=204)
async def follow_artist(
    artist_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    from ..services.lidarr import add_artist_to_lidarr
    a = await db.get(Artist, artist_id)
    if not a:
        raise HTTPException(404, "Artist not found")
    a.followed = True
    if a.musicbrainz_id:
        lidarr_id = await add_artist_to_lidarr(a.name, a.musicbrainz_id)
        if lidarr_id:
            a.lidarr_id = lidarr_id
    await db.commit()


@router.delete("/artists/{artist_id}/follow", status_code=204)
async def unfollow_artist(
    artist_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    from ..services.lidarr import remove_artist_from_lidarr
    a = await db.get(Artist, artist_id)
    if not a:
        raise HTTPException(404, "Artist not found")
    a.followed = False
    if a.lidarr_id:
        await remove_artist_from_lidarr(a.lidarr_id)
        a.lidarr_id = None
    await db.commit()


@router.get("/albums", response_model=list[AlbumOut])
async def list_albums(db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(select(Album).limit(200))
    return [AlbumOut.model_validate(a) for a in result.scalars().all()]
