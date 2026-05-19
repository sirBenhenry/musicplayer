import logging
import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

log = logging.getLogger(__name__)
from pydantic import BaseModel
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import require_auth
from ..core.database import get_db
from ..models.library import Artist, Album, Song
from ..services import navidrome

router = APIRouter(tags=["library"], dependencies=[Depends(require_auth)])


# ── Schemas ──────────────────────────────────────────────────────────────────

class ArtistOut(BaseModel):
    id: uuid.UUID
    navidrome_id: str
    name: str
    followed: bool
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
    duration_sec: Optional[int]
    profile_id: Optional[uuid.UUID]
    needs_profile_assignment: bool
    artist_name: Optional[str] = None
    album_title: Optional[str] = None
    model_config = {"from_attributes": True}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/songs", response_model=list[SongOut])
async def list_songs(
    db: Annotated[AsyncSession, Depends(get_db)],
    profile: Optional[uuid.UUID] = None,
    search: Optional[str] = None,
    unassigned: bool = False,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
):
    q = select(Song)
    if profile:
        q = q.where(Song.profile_id == profile)
    if unassigned:
        q = q.where(Song.needs_profile_assignment == True)  # noqa: E712
    if search:
        q = q.where(Song.title.ilike(f"%{search}%"))
    q = q.offset((page - 1) * limit).limit(limit)
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
            duration_sec=s.duration_sec, profile_id=s.profile_id,
            needs_profile_assignment=s.needs_profile_assignment,
            artist_name=artist_name, album_title=album_title,
        ))
    return out


@router.get("/songs/{song_id}", response_model=SongOut)
async def get_song(song_id: uuid.UUID, db: Annotated[AsyncSession, Depends(get_db)]):
    s = await db.get(Song, song_id)
    if not s:
        raise HTTPException(404, "Song not found")
    return SongOut.model_validate(s)


@router.get("/stream/{navidrome_id}")
async def stream_url(navidrome_id: str):
    return {"url": navidrome.stream_url(navidrome_id)}


class ArtistSearchResult(BaseModel):
    mbid: str
    name: str
    genres: list[str] = []
    image_url: Optional[str] = None
    overview: Optional[str] = None


class ImportArtistRequest(BaseModel):
    mbid: str
    name: str


class TrackSearchResult(BaseModel):
    title: str
    artist: str
    album: str = ""


class DownloadTrackRequest(BaseModel):
    title: str
    artist: str


class DownloadAllRequest(BaseModel):
    mbid: str
    name: str


@router.get("/tracks/search", response_model=list[TrackSearchResult])
async def search_tracks_endpoint(q: str = Query(..., min_length=2)):
    """Search for individual tracks via MusicBrainz recordings."""
    from ..services.musicbrainz import search_recordings
    results = await search_recordings(q, limit=30)
    return [TrackSearchResult(**r) for r in results[:30]]


@router.post("/tracks/download", status_code=202)
async def download_track(body: DownloadTrackRequest, background_tasks: BackgroundTasks):
    """Queue download of a single track — searches for the containing album/single."""
    from ..services import prowlarr, qbittorrent

    async def _do():
        # Search for the album/single that contains this track (more reliable than track-level)
        queries = [
            f"{body.artist} {body.title} FLAC",
            f"{body.artist} {body.title}",
        ]
        for q in queries:
            results = await prowlarr.search(q, categories=[3040])
            if not results:
                results = await prowlarr.search(q, categories=[3000])
            best = prowlarr.pick_best_result(results)
            if best:
                url = best.get("downloadUrl") or best.get("magnetUrl") or ""
                if url:
                    await qbittorrent.add_torrent(url, category="music",
                                                   save_path="/data/torrents/music")
                    return
        log.warning("No torrent found for %s — %s", body.artist, body.title)

    background_tasks.add_task(_do)
    return {"status": "queued", "message": f"Searching for {body.artist} — {body.title}"}


@router.post("/artists/{artist_id}/download-all", status_code=202)
async def download_all_artist(
    artist_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Trigger full discography download for an artist already in the library."""
    from ..services.lidarr import download_artist_discography
    a = await db.get(Artist, artist_id)
    if not a:
        raise HTTPException(404, "Artist not found")
    mbid = getattr(a, 'musicbrainz_id', None)
    if not mbid:
        raise HTTPException(422, "Artist has no MusicBrainz ID — add via Discover tab first")
    lidarr_id = await download_artist_discography(mbid, a.name)
    return {"status": "queued", "lidarr_id": lidarr_id, "message": f"Downloading discography for {a.name}"}


@router.get("/artists/search", response_model=list[ArtistSearchResult])
async def search_new_artists(q: str = Query(..., min_length=2)):
    from ..services.lidarr import search_artists
    results = await search_artists(q)
    out = []
    for r in results[:20]:
        raw_genres = r.get("genres", [])
        genres = [g if isinstance(g, str) else g.get("name", "") for g in raw_genres]
        images = r.get("images", [])
        image_url = next((i.get("url") for i in images if i.get("coverType") == "poster"), None)
        out.append(ArtistSearchResult(
            mbid=r.get("foreignArtistId", ""),
            name=r.get("artistName", ""),
            genres=genres,
            image_url=image_url,
            overview=r.get("overview", ""),
        ))
    return out


@router.post("/artists/import", status_code=202)
async def import_artist(
    body: ImportArtistRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    background_tasks: BackgroundTasks,
):
    import asyncio
    from ..services.lidarr import add_artist_to_lidarr
    from ..services.discography_importer import import_artist_discography

    # Add to Lidarr for future release monitoring only (no initial search)
    lidarr_id = await add_artist_to_lidarr(body.name, body.mbid)

    # Queue per-album download in background: MusicBrainz → Prowlarr → qBittorrent
    background_tasks.add_task(import_artist_discography, body.name, body.mbid)

    return {
        "status": "queued",
        "lidarr_id": lidarr_id,
        "message": f"Fetching discography for {body.name} — albums will appear as they download",
    }


@router.get("/artists", response_model=list[ArtistOut])
async def list_artists(
    db: Annotated[AsyncSession, Depends(get_db)],
    followed: Optional[bool] = None,
):
    q = select(Artist)
    if followed is not None:
        q = q.where(Artist.followed == followed)
    result = await db.execute(q)
    artists = result.scalars().all()
    return [
        ArtistOut(
            id=a.id, navidrome_id=a.navidrome_id, name=a.name,
            followed=a.followed, new_release=a.new_release_flagged_at is not None,
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
