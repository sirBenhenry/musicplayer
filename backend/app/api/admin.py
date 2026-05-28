"""Admin endpoints — manual sync, analysis trigger, bulk import."""
import asyncio
import logging
import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import require_auth
from ..core.database import get_db
from ..jobs.library_sync import run_library_sync
from ..jobs.download_retry import retry_failed_downloads
from ..services.essentia_svc import analyse_pending_songs, analyse_all_songs

_GUIDE_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "import_guide.md")

router = APIRouter(prefix="/admin", tags=["admin"])
log = logging.getLogger(__name__)


async def _resolve_profile_names(db: AsyncSession, names: set[str]) -> dict[str, uuid.UUID]:
    """Return {name: profile_id} for all matching profile names."""
    if not names:
        return {}
    from ..models.profile import Profile
    result = await db.execute(select(Profile).where(Profile.name.in_(names)))
    return {p.name: p.id for p in result.scalars().all()}


@router.get("/import-guide")
async def get_import_guide(db: AsyncSession = Depends(get_db)):
    """Download the import format guide — no auth required. Injects current profile list."""
    from ..models.profile import Profile

    with open(_GUIDE_PATH, encoding="utf-8") as f:
        base = f.read()

    profiles_result = await db.execute(select(Profile).order_by(Profile.created_at))
    profiles = profiles_result.scalars().all()

    if profiles:
        rows = "\n".join(
            f"| `{p.name}` | {p.glyph or ''} | {p.description or ''} |"
            for p in profiles
        )
        profiles_section = (
            "## Current Profiles\n\n"
            "| Name | Glyph | Description |\n"
            "|------|-------|-------------|\n"
            f"{rows}\n\n"
            'Use the `"profile"` field on any song to assign it to a specific profile '
            "(use the exact name from the table above):\n\n"
            '```json\n{"artist": "Ado", "title": "唱", "profile": "ProfileName"}\n```\n\n'
            "Songs with no `profile` field are downloaded without a profile assignment.\n\n"
            "---\n\n"
        )
        base = profiles_section + base

    return PlainTextResponse(
        base,
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="musicapp_import_guide.md"'},
    )


@router.get("/system-status", dependencies=[Depends(require_auth)])
async def get_system_status(db: AsyncSession = Depends(get_db)):
    """Aggregate health + stats for all services, storage, and DB."""
    import asyncio
    import shutil
    import httpx
    from ..core.config import get_settings
    from ..models.events import DownloadJob
    from ..models.library import Song, Artist, Album
    from sqlalchemy import func as _func

    settings = get_settings()

    async def _ping(name: str, coro) -> dict:
        try:
            result = await asyncio.wait_for(coro, timeout=5)
            return {"name": name, "ok": True, **result}
        except Exception as e:
            return {"name": name, "ok": False, "error": str(e)[:120]}

    async def _check_navidrome():
        async with httpx.AsyncClient(timeout=5) as client:
            import hashlib, secrets
            salt = secrets.token_hex(6)
            token = hashlib.md5(f"{settings.NAVIDROME_PASS}{salt}".encode()).hexdigest()
            r = await client.get(
                f"{settings.NAVIDROME_URL}/rest/ping",
                params={"u": settings.NAVIDROME_USER, "t": token, "s": salt,
                        "v": "1.16.1", "c": "musicapp", "f": "json"},
            )
            data = r.json().get("subsonic-response", {})
            return {"version": data.get("version", "")}

    async def _check_lidarr():
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"{settings.LIDARR_URL}/api/v1/system/status",
                headers={"X-Api-Key": settings.LIDARR_KEY},
            )
            r.raise_for_status()
            data = r.json()
            return {"version": data.get("version", "")}

    async def _check_prowlarr():
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"{settings.PROWLARR_URL}/api/v1/system/status",
                headers={"X-Api-Key": settings.PROWLARR_KEY},
            )
            r.raise_for_status()
            data = r.json()
            return {"version": data.get("version", "")}

    async def _check_qbittorrent():
        from ..services.qbittorrent import get_torrents, _req
        r = await _req("GET", "/transfer/info")
        info = r.json()
        active = await get_torrents(category="music", filter="active")
        return {
            "dl_speed": info.get("dl_info_speed", 0),
            "up_speed": info.get("up_info_speed", 0),
            "active_torrents": len(active),
        }

    async def _check_soulseek():
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"{settings.SLSKD_URL}/api/v1/searches",
                headers={"X-API-Key": settings.SLSKD_API_KEY},
            )
            r.raise_for_status()
            searches = r.json() if isinstance(r.json(), list) else []
            active = sum(1 for s in searches if not s.get("isComplete", True))
            return {"active_searches": active}

    # Run all service checks in parallel
    checks = await asyncio.gather(
        _ping("navidrome",   _check_navidrome()),
        _ping("lidarr",      _check_lidarr()),
        _ping("prowlarr",    _check_prowlarr()),
        _ping("qbittorrent", _check_qbittorrent()),
        _ping("soulseek",    _check_soulseek()),
        return_exceptions=False,
    )

    # Storage: actual music folder size + disk partition stats
    storage: dict = {}
    try:
        # Actual bytes used by music files (not the whole NAS partition)
        music_bytes = 0
        music_files = 0
        for root, _, files in os.walk(settings.MUSIC_DIR):
            for f in files:
                try:
                    music_bytes += os.path.getsize(os.path.join(root, f))
                    music_files += 1
                except OSError:
                    pass
        # Disk partition stats (shows NAS free space / total capacity)
        disk = shutil.disk_usage(settings.MUSIC_DIR)
        storage = {
            "music_bytes": music_bytes,
            "music_files": music_files,
            "disk_total_bytes": disk.total,
            "disk_free_bytes": disk.free,
        }
    except Exception as e:
        storage = {"error": str(e)}

    # DB stats
    song_count = (await db.execute(select(_func.count(Song.id)))).scalar() or 0
    artist_count = (await db.execute(select(_func.count(Artist.id)))).scalar() or 0
    # Only count albums that actually have songs (orphaned empty albums excluded)
    from sqlalchemy import exists as _exists
    album_count = (await db.execute(
        select(_func.count(Album.id)).where(
            _exists(select(Song.id).where(Song.album_id == Album.id))
        )
    )).scalar() or 0
    dl_queued = (await db.execute(
        select(_func.count(DownloadJob.id)).where(DownloadJob.status == "queued")
    )).scalar() or 0
    dl_downloading = (await db.execute(
        select(_func.count(DownloadJob.id)).where(DownloadJob.status == "downloading")
    )).scalar() or 0
    dl_failed = (await db.execute(
        select(_func.count(DownloadJob.id)).where(DownloadJob.status == "failed")
    )).scalar() or 0

    return {
        "services": list(checks),
        "storage": storage,
        "library": {
            "songs": song_count,
            "artists": artist_count,
            "albums": album_count,
        },
        "downloads": {
            "queued": dl_queued,
            "downloading": dl_downloading,
            "failed": dl_failed,
        },
    }


@router.post("/sync")
async def trigger_sync(_: str = Depends(require_auth)):
    asyncio.create_task(run_library_sync())
    return {"status": "sync queued"}


@router.post("/analyse")
async def trigger_analyse(_: str = Depends(require_auth)):
    asyncio.create_task(analyse_pending_songs())
    return {"status": "analysis queued"}


@router.post("/analyse-all")
async def trigger_analyse_all(db: AsyncSession = Depends(get_db), _: str = Depends(require_auth)):
    """Wipe analysed_at + vectors and re-analyse every song (picks up new vector format)."""
    from sqlalchemy import update
    from ..models.library import Song
    await db.execute(update(Song).values(analysed_at=None, feature_vector=None))
    await db.commit()
    asyncio.create_task(analyse_all_songs())
    return {"status": "full re-analysis queued for all songs"}


@router.post("/retry-downloads")
async def trigger_retry_downloads(_: str = Depends(require_auth)):
    asyncio.create_task(retry_failed_downloads())
    return {"status": "retry queued"}


# ── Bulk import endpoints ─────────────────────────────────────────────────────

class ImportSongItem(BaseModel):
    artist: str
    title: str
    mb_recording_id: Optional[str] = None
    profile: Optional[str] = None


@router.post("/import-songs", dependencies=[Depends(require_auth)])
async def import_songs(songs: list[ImportSongItem], db: AsyncSession = Depends(get_db)):
    """Queue a list of tracks for download. Duplicates are skipped automatically."""
    from ..services.download_pipeline import request_download
    profile_names = {s.profile for s in songs if s.profile}
    profile_map = await _resolve_profile_names(db, profile_names)
    results = []
    for s in songs:
        if not s.artist.strip() or not s.title.strip():
            continue
        profile_id = profile_map.get(s.profile) if s.profile else None
        job = await request_download(db, "track", s.artist.strip(), s.title.strip(),
                                     mb_recording_id=s.mb_recording_id or None,
                                     profile_id=profile_id)
        results.append({"id": str(job.id), "artist": job.artist, "title": job.title, "status": job.status})
    log.info("import-songs: processed %d tracks → %d queued", len(songs), len(results))
    return {"total": len(results), "jobs": results}


class SetupSong(BaseModel):
    artist: str
    title: str
    mb_recording_id: Optional[str] = None
    profile: Optional[str] = None


class SetupPlaylist(BaseModel):
    name: str
    songs: list[SetupSong] = []


class SetupProfile(BaseModel):
    name: str
    glyph: Optional[str] = None
    hue: Optional[int] = None
    description: Optional[str] = None


class SetupArtist(BaseModel):
    name: str
    mbid: str
    follow: bool = True
    download_recordings: bool = False


class SetupImport(BaseModel):
    profiles: list[SetupProfile] = []
    artists: list[SetupArtist] = []
    songs: list[SetupSong] = []
    playlists: list[SetupPlaylist] = []


@router.post("/import-setup", dependencies=[Depends(require_auth)])
async def import_setup(body: SetupImport, db: AsyncSession = Depends(get_db)):
    """
    Apply a full setup file: create profiles (if missing), queue song downloads,
    create playlists and queue their songs.

    Format:
    {
      "profiles": [{"name": "Ben", "glyph": "🎵", "hue": 180}],
      "songs": [{"artist": "Ado", "title": "唱"}],
      "playlists": [{"name": "Morning Vibes", "songs": [{"artist": "X", "title": "Y"}]}]
    }
    """
    from ..services.download_pipeline import request_download
    from ..models.profile import Profile
    from ..models.playlists import UserPlaylist
    import uuid as _uuid
    from datetime import datetime, timezone

    profiles_created = 0
    for p in body.profiles:
        if not p.name.strip():
            continue
        existing = (await db.execute(
            select(Profile).where(Profile.name == p.name.strip())
        )).scalars().first()
        if not existing:
            db.add(Profile(
                name=p.name.strip(),
                glyph=p.glyph,
                hue=p.hue,
                description=p.description,
                is_catchall=False,
                daily_auto_generate=True,
            ))
            profiles_created += 1
    if profiles_created:
        await db.flush()

    artists_imported = 0
    artist_songs_queued = 0
    for a in body.artists:
        if not a.name.strip() or not a.mbid.strip():
            continue
        try:
            from ..services.lidarr import add_artist_to_lidarr
            from ..services import musicbrainz
            from ..models.library import Artist
            from sqlalchemy.dialects.postgresql import insert as _pg_insert
            from datetime import datetime as _dt, timezone as _tz
            lidarr_id = await add_artist_to_lidarr(a.name, a.mbid)
            if a.follow:
                placeholder_id = f"mb:{a.mbid}"
                stmt = _pg_insert(Artist).values(
                    navidrome_id=placeholder_id,
                    name=a.name.strip(),
                    musicbrainz_id=a.mbid.strip(),
                    followed=True,
                    lidarr_id=lidarr_id,
                    added_at=_dt.now(_tz.utc),
                    updated_at=_dt.now(_tz.utc),
                ).on_conflict_do_update(
                    index_elements=["navidrome_id"],
                    set_={"followed": True, "lidarr_id": lidarr_id,
                          "updated_at": _dt.now(_tz.utc)},
                )
                await db.execute(stmt)
            if a.download_recordings:
                recordings = await musicbrainz.get_artist_recordings(a.mbid)
                for rec in (recordings or []):
                    title = rec.get("title", "").strip()
                    mb_rec_id = rec.get("mb_recording_id")
                    if title:
                        await request_download(db, "track", a.name.strip(), title,
                                               mb_recording_id=mb_rec_id)
                        artist_songs_queued += 1
            artists_imported += 1
        except Exception as e:
            log.warning("import-setup: artist '%s' failed: %s", a.name, e)

    if artists_imported:
        await db.flush()

    # Resolve all profile names referenced by songs and playlist songs
    all_profile_names = {s.profile for s in body.songs if s.profile}
    for pl in body.playlists:
        all_profile_names.update(s.profile for s in pl.songs if s.profile)
    profile_map = await _resolve_profile_names(db, all_profile_names)

    songs_queued = 0
    for s in body.songs:
        if not s.artist.strip() or not s.title.strip():
            continue
        profile_id = profile_map.get(s.profile) if s.profile else None
        await request_download(db, "track", s.artist.strip(), s.title.strip(),
                               mb_recording_id=s.mb_recording_id or None,
                               profile_id=profile_id)
        songs_queued += 1

    playlists_created = 0
    playlist_songs_queued = 0
    now = datetime.now(timezone.utc)
    for pl in body.playlists:
        if not pl.name.strip():
            continue
        playlist = UserPlaylist(id=_uuid.uuid4(), name=pl.name.strip(), songs=[],
                                created_at=now, updated_at=now)
        db.add(playlist)
        await db.flush()
        playlists_created += 1
        for s in pl.songs:
            if not s.artist.strip() or not s.title.strip():
                continue
            profile_id = profile_map.get(s.profile) if s.profile else None
            await request_download(db, "track", s.artist.strip(), s.title.strip(),
                                   user_playlist_id=playlist.id,
                                   mb_recording_id=s.mb_recording_id or None,
                                   profile_id=profile_id)
            playlist_songs_queued += 1

    await db.commit()
    log.info("import-setup: %d profiles, %d songs, %d playlists (%d playlist songs)",
             profiles_created, songs_queued, playlists_created, playlist_songs_queued)
    return {
        "profiles_created": profiles_created,
        "songs_queued": songs_queued,
        "playlists_created": playlists_created,
        "playlist_songs_queued": playlist_songs_queued,
    }


# ── Library export / apply ────────────────────────────────────────────────────

@router.get("/export-library", dependencies=[Depends(require_auth)])
async def export_library(db: AsyncSession = Depends(get_db)):
    """
    Export all songs with their profile assignments.
    Returns JSON suitable for Claude analysis.
    Format:
      { "profiles": [{id, name}], "songs": [{id, title, artist, album, profile}] }
    """
    from datetime import datetime, timezone
    from ..models.profile import Profile
    from ..models.library import Song, Artist, Album

    from ..models.library import Album

    profiles_rows = (await db.execute(select(Profile).order_by(Profile.name))).scalars().all()
    profile_map = {p.id: p.name for p in profiles_rows}
    profiles_out = [{"id": str(p.id), "name": p.name} for p in profiles_rows if not p.is_catchall]

    songs_q = (await db.execute(
        select(Song, Artist, Album)
        .outerjoin(Artist, Song.artist_id == Artist.id)
        .outerjoin(Album, Song.album_id == Album.id)
        .order_by(Artist.name, Song.title)
    )).all()

    songs_out = []
    for song, artist, album in songs_q:
        songs_out.append({
            "id": str(song.id),
            "title": song.title or "",
            "artist": artist.name if artist else "",
            "album": album.title if album else "",
            "profile": profile_map.get(song.profile_id) if song.profile_id else None,
        })

    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "profiles": profiles_out,
        "songs": songs_out,
    }


class ApplySong(BaseModel):
    id: str
    profile: Optional[str] = "__unchanged__"
    delete: bool = False


class ApplyLibraryRequest(BaseModel):
    songs: list[ApplySong]


@router.post("/apply-library", dependencies=[Depends(require_auth)])
async def apply_library(body: ApplyLibraryRequest, db: AsyncSession = Depends(get_db)):
    """
    Apply profile reassignments and/or deletions from a Claude-edited export file.

    Each song entry:
      {"id": "uuid", "profile": "Japanese"}   → reassign profile
      {"id": "uuid", "profile": null}          → unassign (show only in All Music)
      {"id": "uuid", "delete": true}           → delete file + DB record

    Songs not listed are untouched.
    """
    from ..models.profile import Profile
    from ..models.library import Song
    from ..core.config import get_settings
    from ..services import navidrome

    settings = get_settings()

    profiles_rows = (await db.execute(select(Profile))).scalars().all()
    profile_by_name = {p.name.lower(): p.id for p in profiles_rows}

    deleted = 0
    assigned = 0
    errors: list[str] = []
    trigger_rescan = False

    for item in body.songs:
        try:
            song_id = uuid.UUID(item.id)
        except Exception:
            errors.append(f"invalid id: {item.id}")
            continue

        song = await db.get(Song, song_id)
        if not song:
            errors.append(f"not found: {item.id}")
            continue

        if item.delete:
            if song.file_path:
                abs_path = (song.file_path if song.file_path.startswith('/')
                            else os.path.join(settings.MUSIC_DIR, song.file_path))
                if os.path.exists(abs_path):
                    try:
                        os.remove(abs_path)
                    except Exception as e:
                        log.warning("apply-library: file remove failed %s: %s", abs_path, e)
            await db.delete(song)
            deleted += 1
            trigger_rescan = True
        elif item.profile != "__unchanged__":
            if item.profile is None:
                song.profile_id = None
            else:
                pid = profile_by_name.get(item.profile.lower())
                if pid is None:
                    errors.append(f"profile not found: {item.profile!r}")
                    continue
                song.profile_id = pid
            song.needs_profile_assignment = False
            assigned += 1

    await db.commit()

    if trigger_rescan:
        asyncio.create_task(navidrome.trigger_scan())

    log.info("apply-library: %d assigned, %d deleted, %d errors", assigned, deleted, len(errors))
    return {"assigned": assigned, "deleted": deleted, "errors": errors}
