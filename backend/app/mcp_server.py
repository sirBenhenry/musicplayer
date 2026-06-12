"""MCP server — full music library management tools.

Mount: app.mount("/mcp", create_mcp_app())
Claude Desktop config (~AppData/Roaming/Claude/claude_desktop_config.json):
  { "mcpServers": { "musicplayer": { "url": "http://10.1.8.4:8001/mcp/" } } }
"""
import json
import logging
import uuid as _uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

log = logging.getLogger(__name__)

_mcp = FastMCP(
    "musicplayer",
    streamable_http_path="/",
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=False,
        allowed_hosts=["*"],
        allowed_origins=["*"],
    ),
    instructions=(
        "Self-hosted personal music library manager.\n\n"
        "SEARCH & DOWNLOAD:\n"
        "  search_recordings → queue_download (always search MB first for accurate identity)\n"
        "  bulk_queue_downloads — queue many tracks at once (preferred for batch imports)\n\n"
        "LIBRARY:\n"
        "  get_library, search_library, delete_song, assign_song_profile\n"
        "  bulk_assign_profile — assign many songs to one profile in one call\n"
        "  bulk_reassign_songs — assign many songs to DIFFERENT profiles in one call [{song_id, profile_id}]\n"
        "  bulk_delete_songs — delete many songs in one call\n\n"
        "ARTISTS:\n"
        "  search_artists → add_artist (library only) or follow_artist (library + Lidarr monitoring)\n"
        "  unfollow_artist, get_artist_songs\n\n"
        "PLAYLISTS:\n"
        "  get_playlists, create_playlist, rename_playlist, delete_playlist\n"
        "  add_song_to_playlist, remove_song_from_playlist\n\n"
        "PROFILES:\n"
        "  get_profiles, create_profile, update_profile\n\n"
        "DOWNLOADS:\n"
        "  get_download_status, get_active_downloads"
    ),
)


# ── Search & Download ─────────────────────────────────────────────────────────

@_mcp.tool()
async def search_recordings(query: str, limit: int = 10) -> str:
    """Search MusicBrainz for studio recordings (no live, no remixes).

    Use "Artist - Song Title" format for best results.
    Returns [{title, artist, album, mb_recording_id, score}].
    Score 0-100; prefer ≥80. Use mb_recording_id in queue_download.
    """
    from .services.musicbrainz import search_recordings as _search
    results = await _search(query, limit=max(1, min(limit, 25)), search_filter="studio")
    return json.dumps(results, ensure_ascii=False, indent=2)


@_mcp.tool()
async def queue_download(
    mb_recording_id: str,
    title: str,
    artist: str,
    profile_id: Optional[str] = None,
) -> str:
    """Queue a MusicBrainz recording for download.

    Get mb_recording_id from search_recordings first.
    profile_id: assign song to this profile after download (optional).
    Returns {job_id, status}.
    """
    from .core.database import AsyncSessionLocal
    from .services.download_pipeline import request_download
    profile_uuid = _parse_uuid(profile_id)
    try:
        async with AsyncSessionLocal() as db:
            job = await request_download(db, "track", artist, title,
                                         mb_recording_id=mb_recording_id, profile_id=profile_uuid)
            await db.commit()
        return json.dumps({"job_id": str(job.id), "status": job.status})
    except Exception as e:
        return json.dumps({"error": str(e)})


# ── Library ───────────────────────────────────────────────────────────────────

@_mcp.tool()
async def get_library(profile_id: Optional[str] = None, limit: int = 200, include_staged: bool = False) -> str:
    """List songs in the library.

    profile_id: filter to a specific profile (omit = all songs).
    include_staged: include daily-playlist staged songs. Default False.
    Returns [{id, title, artist, profile_id, is_staged, from_daily_playlist}].

    from_daily_playlist=true means the song was downloaded by the AI discovery system.
    These songs need profile assignment based on their genre/style.
    from_daily_playlist=false means it was in the original library (Navidrome import).
    """
    from sqlalchemy import select, exists
    from sqlalchemy.orm import selectinload
    from .core.database import AsyncSessionLocal
    from .models.library import Song, Artist
    from .models.events import DownloadJob
    async with AsyncSessionLocal() as db:
        q = select(Song).options(selectinload(Song.artist)).order_by(Song.title).limit(min(limit, 2000))
        if profile_id:
            pid = _parse_uuid(profile_id)
            if pid:
                q = q.where(Song.profile_id == pid)
        if not include_staged:
            q = q.where(Song.is_staged == False)  # noqa: E712
        result = await db.execute(q)
        songs = result.scalars().all()

        # Build set of (lower_artist, lower_title) for songs that came from daily playlists
        daily_q = await db.execute(
            select(DownloadJob.artist, DownloadJob.title)
            .where(DownloadJob.playlist_id.isnot(None), DownloadJob.status == "completed")
        )
        daily_keys = {(r.artist.lower(), r.title.lower()) for r in daily_q.all()}

    out = []
    for s in songs:
        artist_str = s.display_artist or (s.artist.name if s.artist else "")
        from_daily = (artist_str.lower(), s.title.lower()) in daily_keys
        out.append({
            "id": str(s.id),
            "title": s.title,
            "artist": artist_str,
            "profile_id": str(s.profile_id) if s.profile_id else None,
            "is_staged": bool(s.is_staged),
            "from_daily_playlist": from_daily,
        })
    return json.dumps(out, ensure_ascii=False, indent=2)


@_mcp.tool()
async def search_library(query: str, profile_id: Optional[str] = None, limit: int = 50, include_staged: bool = False) -> str:
    """Search songs in the library by title or artist name.

    include_staged: include daily-playlist staged songs. Default False (exclude them).
    Returns [{id, title, artist, profile_id, is_staged}].
    """
    from sqlalchemy import select, or_, func
    from sqlalchemy.orm import selectinload
    from .core.database import AsyncSessionLocal
    from .models.library import Song, Artist
    async with AsyncSessionLocal() as db:
        q = (select(Song)
             .join(Artist, Song.artist_id == Artist.id, isouter=True)
             .options(selectinload(Song.artist))
             .where(or_(
                 Song.title.ilike(f"%{query}%"),
                 Artist.name.ilike(f"%{query}%"),
                 Song.display_artist.ilike(f"%{query}%"),
             ))
             .limit(min(limit, 200)))
        if profile_id:
            pid = _parse_uuid(profile_id)
            if pid:
                q = q.where(Song.profile_id == pid)
        if not include_staged:
            q = q.where(Song.is_staged == False)  # noqa: E712
        result = await db.execute(q)
        songs = result.scalars().all()
    return json.dumps([{
        "id": str(s.id),
        "title": s.title,
        "artist": s.display_artist or (s.artist.name if s.artist else ""),
        "profile_id": str(s.profile_id) if s.profile_id else None,
        "is_staged": bool(s.is_staged),
    } for s in songs], ensure_ascii=False, indent=2)


@_mcp.tool()
async def delete_song(song_id: str) -> str:
    """Permanently delete a song from the library (removes file from disk).

    song_id: UUID from get_library or search_library.
    Returns {deleted: true} or {error: ...}.
    """
    import os
    from sqlalchemy import select
    from .core.database import AsyncSessionLocal
    from .models.library import Song
    from .core.config import get_settings
    from .services.navidrome import trigger_scan
    sid = _parse_uuid(song_id)
    if not sid:
        return json.dumps({"error": "Invalid song_id"})
    try:
        async with AsyncSessionLocal() as db:
            song = await db.get(Song, sid)
            if not song:
                return json.dumps({"error": "Song not found"})
            music_dir = get_settings().MUSIC_DIR
            if song.file_path:
                abs_path = song.file_path if song.file_path.startswith("/") else os.path.join(music_dir, song.file_path)
                if os.path.exists(abs_path):
                    os.remove(abs_path)
            await db.delete(song)
            await db.commit()
        await trigger_scan()
        return json.dumps({"deleted": True, "song_id": song_id})
    except Exception as e:
        return json.dumps({"error": str(e)})


@_mcp.tool()
async def assign_song_profile(song_id: str, profile_id: Optional[str] = None) -> str:
    """Move a song to a different taste profile.

    profile_id: profile UUID to assign to, or null/omit to unassign (moves to All Music).
    Returns {updated: true}.
    """
    from .core.database import AsyncSessionLocal
    from .models.library import Song
    sid = _parse_uuid(song_id)
    if not sid:
        return json.dumps({"error": "Invalid song_id"})
    pid = _parse_uuid(profile_id) if profile_id else None
    try:
        async with AsyncSessionLocal() as db:
            song = await db.get(Song, sid)
            if not song:
                return json.dumps({"error": "Song not found"})
            if song.is_staged:
                return json.dumps({"error": "Song is staged (daily playlist download awaiting EOD) — cannot manually reassign"})
            song.profile_id = pid
            song.needs_profile_assignment = False
            await db.commit()
        _bump_stamp()
        return json.dumps({"updated": True, "song_id": song_id, "profile_id": profile_id})
    except Exception as e:
        return json.dumps({"error": str(e)})


# ── Bulk operations ───────────────────────────────────────────────────────────

@_mcp.tool()
async def bulk_assign_profile(song_ids: list[str], profile_id: Optional[str] = None) -> str:
    """Assign many songs to one profile in a single database transaction.

    song_ids: list of song UUIDs (from get_library).
    profile_id: profile UUID to assign to, or null to unassign (moves to All Music).
    Skips staged songs silently.
    Returns {updated: N, skipped_staged: N, not_found: N}.
    """
    from sqlalchemy import select
    from .core.database import AsyncSessionLocal
    from .models.library import Song
    pid = _parse_uuid(profile_id) if profile_id else None
    valid_ids = [_parse_uuid(s) for s in song_ids]
    valid_ids = [v for v in valid_ids if v is not None]
    if not valid_ids:
        return json.dumps({"error": "No valid song UUIDs provided"})
    updated = skipped_staged = not_found = 0
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Song).where(Song.id.in_(valid_ids)))
            songs = result.scalars().all()
            found_ids = {s.id for s in songs}
            not_found = len(valid_ids) - len(found_ids)
            for song in songs:
                if song.is_staged:
                    skipped_staged += 1
                    continue
                song.profile_id = pid
                song.needs_profile_assignment = False
                updated += 1
            await db.commit()
        _bump_stamp()
        return json.dumps({"updated": updated, "skipped_staged": skipped_staged, "not_found": not_found})
    except Exception as e:
        return json.dumps({"error": str(e)})


@_mcp.tool()
async def bulk_delete_songs(song_ids: list[str]) -> str:
    """Permanently delete many songs in one operation.

    song_ids: list of song UUIDs (from get_library).
    Removes files from disk + DB rows, then triggers one Navidrome rescan.
    Returns {deleted: N, not_found: N, errors: [...]}.
    """
    import os
    from sqlalchemy import select
    from .core.database import AsyncSessionLocal
    from .models.library import Song
    from .core.config import get_settings
    from .services.navidrome import trigger_scan
    valid_ids = [_parse_uuid(s) for s in song_ids]
    valid_ids = [v for v in valid_ids if v is not None]
    if not valid_ids:
        return json.dumps({"error": "No valid song UUIDs provided"})
    deleted = not_found = 0
    errors: list[str] = []
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Song).where(Song.id.in_(valid_ids)))
            songs = result.scalars().all()
            not_found = len(valid_ids) - len(songs)
            music_dir = get_settings().MUSIC_DIR
            for song in songs:
                try:
                    if song.file_path:
                        abs_path = song.file_path if song.file_path.startswith("/") else os.path.join(music_dir, song.file_path)
                        if os.path.exists(abs_path):
                            os.remove(abs_path)
                    await db.delete(song)
                    deleted += 1
                except Exception as e:
                    errors.append(f"{song.id}: {e}")
            await db.commit()
        await trigger_scan()
        return json.dumps({"deleted": deleted, "not_found": not_found, "errors": errors})
    except Exception as e:
        return json.dumps({"error": str(e)})


@_mcp.tool()
async def bulk_reassign_songs(assignments: list[dict]) -> str:
    """Reassign many songs to different profiles in one transaction.

    assignments: list of {song_id: "uuid", profile_id: "uuid"|null} dicts.
    profile_id null = unassign (move to All Music).
    Skips staged songs silently.
    Returns {updated: N, skipped_staged: N, not_found: N, errors: [...]}.

    Use this when different songs go to different profiles — more efficient than
    calling bulk_assign_profile once per profile.
    """
    from sqlalchemy import select
    from .core.database import AsyncSessionLocal
    from .models.library import Song
    if not assignments:
        return json.dumps({"error": "No assignments provided"})
    # Parse all IDs up front
    parsed = []
    errors: list[str] = []
    for a in assignments:
        sid = _parse_uuid(a.get("song_id", ""))
        if not sid:
            errors.append(f"Invalid song_id: {a.get('song_id')}")
            continue
        pid = _parse_uuid(a.get("profile_id", "")) if a.get("profile_id") else None
        parsed.append((sid, pid))
    if not parsed:
        return json.dumps({"error": "No valid entries", "errors": errors})
    song_id_map = {sid: pid for sid, pid in parsed}
    updated = skipped_staged = not_found = 0
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Song).where(Song.id.in_(list(song_id_map.keys()))))
            songs = result.scalars().all()
            not_found = len(song_id_map) - len(songs)
            for song in songs:
                if song.is_staged:
                    skipped_staged += 1
                    continue
                song.profile_id = song_id_map[song.id]
                song.needs_profile_assignment = False
                updated += 1
            await db.commit()
        _bump_stamp()
        return json.dumps({"updated": updated, "skipped_staged": skipped_staged,
                           "not_found": not_found, "errors": errors})
    except Exception as e:
        return json.dumps({"error": str(e)})


@_mcp.tool()
async def bulk_queue_downloads(
    tracks: list[dict],
    profile_id: Optional[str] = None,
) -> str:
    """Queue many tracks for download in one call.

    tracks: list of {artist, title, mb_recording_id?} dicts.
    profile_id: assign all downloaded songs to this profile.
    Dedup: songs already in library or already queued are skipped (not re-downloaded).
    Returns {queued: N, skipped: N, errors: [...]}.
    """
    from .core.database import AsyncSessionLocal
    from .services.download_pipeline import request_download
    profile_uuid = _parse_uuid(profile_id) if profile_id else None
    queued = skipped = 0
    errors: list[str] = []
    for track in tracks:
        artist = track.get("artist", "")
        title = track.get("title", "")
        mb_id = track.get("mb_recording_id") or None
        if not artist or not title:
            errors.append(f"Missing artist or title: {track}")
            continue
        try:
            async with AsyncSessionLocal() as db:
                job = await request_download(db, "track", artist, title,
                                             mb_recording_id=mb_id, profile_id=profile_uuid)
                await db.commit()
            if job.status in ("completed",) and job.pipeline_log and \
               any(s.get("step") == "skipped" for s in (job.pipeline_log or [])):
                skipped += 1
            else:
                queued += 1
        except Exception as e:
            errors.append(f"{artist} - {title}: {e}")
    return json.dumps({"queued": queued, "skipped": skipped, "errors": errors})


# ── Artists ───────────────────────────────────────────────────────────────────

@_mcp.tool()
async def search_artists(query: str) -> str:
    """Search for artists not yet in your library (from Lidarr/MusicBrainz).

    Returns [{name, mbid, disambiguation}] — use mbid in add_artist / follow_artist.
    """
    import httpx
    from .core.config import get_settings
    s = get_settings()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{s.LIDARR_URL}/api/v1/artist/lookup",
                params={"term": query},
                headers={"X-Api-Key": s.LIDARR_KEY},
            )
            r.raise_for_status()
            results = r.json()[:10]
        return json.dumps([{
            "name": a.get("artistName", ""),
            "mbid": a.get("foreignArtistId", ""),
            "disambiguation": a.get("disambiguation", ""),
            "genres": [g.get("name") for g in a.get("genres", [])[:3]],
        } for a in results], ensure_ascii=False, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@_mcp.tool()
async def add_artist(artist_name: str, mbid: str) -> str:
    """Add an artist to your library (no Lidarr monitoring, no new-release alerts).

    Use follow_artist instead if you want automatic new releases.
    mbid: MusicBrainz artist ID from search_artists.
    """
    from sqlalchemy import select
    from .core.database import AsyncSessionLocal
    from .models.library import Artist
    try:
        async with AsyncSessionLocal() as db:
            existing = await db.execute(select(Artist).where(Artist.musicbrainz_id == mbid).limit(1))
            artist = existing.scalar_one_or_none()
            if artist:
                artist.followed = True
            else:
                artist = Artist(
                    navidrome_id=f"mb:{mbid}",
                    name=artist_name,
                    musicbrainz_id=mbid,
                    followed=True,
                )
                db.add(artist)
            await db.commit()
            artist_id = str(artist.id)
        return json.dumps({"added": True, "artist_id": artist_id, "name": artist_name})
    except Exception as e:
        return json.dumps({"error": str(e)})


@_mcp.tool()
async def follow_artist(artist_id: str) -> str:
    """Follow an artist: adds to library AND enables Lidarr monitoring for new releases.

    artist_id: UUID from get_library artists or add_artist response.
    Use search_artists + add_artist first if the artist isn't in the DB yet.
    """
    from sqlalchemy import select
    from .core.database import AsyncSessionLocal
    from .models.library import Artist
    from .services.lidarr import add_artist_to_lidarr
    aid = _parse_uuid(artist_id)
    if not aid:
        return json.dumps({"error": "Invalid artist_id"})
    try:
        async with AsyncSessionLocal() as db:
            artist = await db.get(Artist, aid)
            if not artist:
                return json.dumps({"error": "Artist not found — use add_artist first"})
            artist.followed = True
            if artist.musicbrainz_id and not artist.lidarr_id:
                try:
                    lidarr_id = await add_artist_to_lidarr(artist.name, artist.musicbrainz_id)
                    if lidarr_id:
                        artist.lidarr_id = lidarr_id
                except Exception as e:
                    log.warning("follow_artist: Lidarr failed for %s: %s", artist.name, e)
            await db.commit()
            monitored = artist.lidarr_id is not None
        _bump_stamp()
        return json.dumps({"following": True, "artist_id": artist_id, "monitored_in_lidarr": monitored})
    except Exception as e:
        return json.dumps({"error": str(e)})


@_mcp.tool()
async def unfollow_artist(artist_id: str) -> str:
    """Unfollow an artist: removes from library and stops Lidarr monitoring."""
    from .core.database import AsyncSessionLocal
    from .models.library import Artist
    from .services.lidarr import remove_artist_from_lidarr
    aid = _parse_uuid(artist_id)
    if not aid:
        return json.dumps({"error": "Invalid artist_id"})
    try:
        async with AsyncSessionLocal() as db:
            artist = await db.get(Artist, aid)
            if not artist:
                return json.dumps({"error": "Artist not found"})
            artist.followed = False
            if artist.lidarr_id:
                try:
                    await remove_artist_from_lidarr(artist.lidarr_id)
                except Exception:
                    pass
                artist.lidarr_id = None
            await db.commit()
        _bump_stamp()
        return json.dumps({"unfollowed": True, "artist_id": artist_id})
    except Exception as e:
        return json.dumps({"error": str(e)})


@_mcp.tool()
async def get_artist_songs(artist_id: str) -> str:
    """List all songs by an artist in the library.

    artist_id: UUID from get_library or search_library.
    Returns [{id, title, profile_id, duration_sec}].
    """
    from sqlalchemy import select
    from .core.database import AsyncSessionLocal
    from .models.library import Song, Artist
    aid = _parse_uuid(artist_id)
    if not aid:
        return json.dumps({"error": "Invalid artist_id"})
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Song).where(Song.artist_id == aid).order_by(Song.title)
        )
        songs = result.scalars().all()
    return json.dumps([{
        "id": str(s.id), "title": s.title,
        "profile_id": str(s.profile_id) if s.profile_id else None,
        "duration_sec": s.duration_sec,
    } for s in songs], indent=2)


# ── Playlists ─────────────────────────────────────────────────────────────────

@_mcp.tool()
async def get_playlists(profile_id: Optional[str] = None) -> str:
    """List user-created playlists.

    Returns [{id, name, song_count, profile_id}].
    """
    from sqlalchemy import select
    from .core.database import AsyncSessionLocal
    from .models.playlists import UserPlaylist
    async with AsyncSessionLocal() as db:
        q = select(UserPlaylist).order_by(UserPlaylist.name)
        if profile_id:
            pid = _parse_uuid(profile_id)
            if pid:
                q = q.where(UserPlaylist.profile_id == pid)
        result = await db.execute(q)
        pls = result.scalars().all()
    return json.dumps([{
        "id": str(p.id), "name": p.name,
        "song_count": len(p.songs or []),
        "profile_id": str(p.profile_id) if p.profile_id else None,
    } for p in pls], indent=2)


@_mcp.tool()
async def create_playlist(name: str, profile_id: Optional[str] = None) -> str:
    """Create a new user playlist.

    Returns {id, name}.
    """
    from .core.database import AsyncSessionLocal
    from .models.playlists import UserPlaylist
    pid = _parse_uuid(profile_id) if profile_id else None
    try:
        async with AsyncSessionLocal() as db:
            pl = UserPlaylist(name=name, songs=[], profile_id=pid)
            db.add(pl)
            await db.flush()
            pl_id = str(pl.id)
            await db.commit()
        return json.dumps({"id": pl_id, "name": name})
    except Exception as e:
        return json.dumps({"error": str(e)})


@_mcp.tool()
async def rename_playlist(playlist_id: str, new_name: str) -> str:
    """Rename a user playlist."""
    from .core.database import AsyncSessionLocal
    from .models.playlists import UserPlaylist
    pid = _parse_uuid(playlist_id)
    if not pid:
        return json.dumps({"error": "Invalid playlist_id"})
    try:
        async with AsyncSessionLocal() as db:
            pl = await db.get(UserPlaylist, pid)
            if not pl:
                return json.dumps({"error": "Playlist not found"})
            pl.name = new_name
            await db.commit()
        return json.dumps({"updated": True, "playlist_id": playlist_id, "name": new_name})
    except Exception as e:
        return json.dumps({"error": str(e)})


@_mcp.tool()
async def delete_playlist(playlist_id: str) -> str:
    """Delete a user playlist (does not delete the songs themselves)."""
    from .core.database import AsyncSessionLocal
    from .models.playlists import UserPlaylist
    pid = _parse_uuid(playlist_id)
    if not pid:
        return json.dumps({"error": "Invalid playlist_id"})
    try:
        async with AsyncSessionLocal() as db:
            pl = await db.get(UserPlaylist, pid)
            if not pl:
                return json.dumps({"error": "Playlist not found"})
            await db.delete(pl)
            await db.commit()
        return json.dumps({"deleted": True})
    except Exception as e:
        return json.dumps({"error": str(e)})


@_mcp.tool()
async def add_song_to_playlist(playlist_id: str, song_id: str) -> str:
    """Add a song to a user playlist.

    song_id: UUID from get_library or search_library.
    """
    from sqlalchemy.orm.attributes import flag_modified
    from sqlalchemy import select
    from .core.database import AsyncSessionLocal
    from .models.playlists import UserPlaylist
    from .models.library import Song, Artist
    pid = _parse_uuid(playlist_id)
    sid = _parse_uuid(song_id)
    if not pid or not sid:
        return json.dumps({"error": "Invalid UUID"})
    try:
        async with AsyncSessionLocal() as db:
            pl = await db.get(UserPlaylist, pid)
            if not pl:
                return json.dumps({"error": "Playlist not found"})
            from sqlalchemy.orm import selectinload
            song_q = await db.execute(
                select(Song).where(Song.id == sid).options(selectinload(Song.artist))
            )
            song = song_q.scalar_one_or_none()
            if not song:
                return json.dumps({"error": "Song not found"})
            songs_list = list(pl.songs or [])
            if str(song.id) not in {s.get("id") for s in songs_list}:
                songs_list.append({
                    "id": str(song.id),
                    "navidrome_id": song.navidrome_id or "",
                    "title": song.title,
                    "artist": song.display_artist or (song.artist.name if song.artist else ""),
                    "duration_sec": song.duration_sec or 0,
                })
                pl.songs = songs_list
                flag_modified(pl, "songs")
            await db.commit()
        return json.dumps({"added": True, "playlist_id": playlist_id, "song_id": song_id})
    except Exception as e:
        return json.dumps({"error": str(e)})


@_mcp.tool()
async def remove_song_from_playlist(playlist_id: str, song_id: str) -> str:
    """Remove a song from a user playlist."""
    from sqlalchemy.orm.attributes import flag_modified
    from .core.database import AsyncSessionLocal
    from .models.playlists import UserPlaylist
    pid = _parse_uuid(playlist_id)
    if not pid:
        return json.dumps({"error": "Invalid playlist_id"})
    try:
        async with AsyncSessionLocal() as db:
            pl = await db.get(UserPlaylist, pid)
            if not pl:
                return json.dumps({"error": "Playlist not found"})
            pl.songs = [s for s in (pl.songs or []) if s.get("id") != song_id]
            flag_modified(pl, "songs")
            await db.commit()
        return json.dumps({"removed": True})
    except Exception as e:
        return json.dumps({"error": str(e)})


# ── Profiles ──────────────────────────────────────────────────────────────────

@_mcp.tool()
async def get_profiles() -> str:
    """List all taste profiles.

    Returns [{id, name, description, is_catchall, song_count}].
    """
    from sqlalchemy import select, func
    from .core.database import AsyncSessionLocal
    from .models.profile import Profile
    from .models.library import Song
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Profile).order_by(Profile.name))
        profiles = result.scalars().all()
        counts = {}
        for p in profiles:
            cnt = await db.scalar(select(func.count()).where(Song.profile_id == p.id))
            counts[str(p.id)] = cnt or 0
    return json.dumps([{
        "id": str(p.id), "name": p.name,
        "description": p.description or "",
        "is_catchall": p.is_catchall,
        "song_count": counts[str(p.id)],
        "daily_auto_generate": p.daily_auto_generate,
    } for p in profiles], indent=2)


@_mcp.tool()
async def create_profile(name: str, description: str = "", glyph: str = "♪") -> str:
    """Create a new taste profile.

    Returns {id, name}.
    """
    from .core.database import AsyncSessionLocal
    from .models.profile import Profile
    try:
        async with AsyncSessionLocal() as db:
            p = Profile(name=name, description=description or None, glyph=glyph,
                        is_catchall=False, daily_auto_generate=False)
            db.add(p)
            await db.flush()
            pid = str(p.id)
            await db.commit()
        return json.dumps({"id": pid, "name": name})
    except Exception as e:
        return json.dumps({"error": str(e)})


@_mcp.tool()
async def update_profile(profile_id: str, name: Optional[str] = None, description: Optional[str] = None) -> str:
    """Update a profile's name or description."""
    from .core.database import AsyncSessionLocal
    from .models.profile import Profile
    pid = _parse_uuid(profile_id)
    if not pid:
        return json.dumps({"error": "Invalid profile_id"})
    try:
        async with AsyncSessionLocal() as db:
            p = await db.get(Profile, pid)
            if not p:
                return json.dumps({"error": "Profile not found"})
            if name is not None:
                p.name = name
            if description is not None:
                p.description = description
            await db.commit()
        return json.dumps({"updated": True, "profile_id": profile_id})
    except Exception as e:
        return json.dumps({"error": str(e)})


# ── Downloads ─────────────────────────────────────────────────────────────────

@_mcp.tool()
async def get_download_status(job_id: str) -> str:
    """Get status of a download job (queued/downloading/completed/failed/exhausted).

    Returns {job_id, status, artist, title, source_used, pipeline_steps}.
    """
    from .core.database import AsyncSessionLocal
    from .models.events import DownloadJob
    jid = _parse_uuid(job_id)
    if not jid:
        return json.dumps({"error": "Invalid job_id"})
    async with AsyncSessionLocal() as db:
        job = await db.get(DownloadJob, jid)
        if not job:
            return json.dumps({"error": "Job not found"})
        return json.dumps({
            "job_id": str(job.id), "status": job.status,
            "artist": job.artist, "title": job.title,
            "source_used": job.source_used,
            "confidence_score": job.confidence_score,
            "last_error": job.last_error,
            "pipeline_steps": [
                {"step": s.get("step"), "status": s.get("status"), "message": s.get("message")}
                for s in (job.pipeline_log or [])
            ],
        })


@_mcp.tool()
async def get_active_downloads() -> str:
    """Show all currently active downloads (queued + downloading).

    Returns [{job_id, status, artist, title}].
    """
    from sqlalchemy import select
    from .core.database import AsyncSessionLocal
    from .models.events import DownloadJob
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(DownloadJob)
            .where(DownloadJob.status.in_(["queued", "downloading"]))
            .order_by(DownloadJob.created_at.desc())
            .limit(50)
        )
        jobs = result.scalars().all()
    return json.dumps([{
        "job_id": str(j.id), "status": j.status,
        "artist": j.artist, "title": j.title,
    } for j in jobs], indent=2)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _bump_stamp() -> None:
    """Update library stamp without importing api.library (avoids circular import)."""
    try:
        import app.api.library as _lib
        _lib._library_stamp = __import__('datetime').datetime.now(__import__('datetime').timezone.utc)
    except Exception:
        pass


def _parse_uuid(s: Optional[str]) -> Optional[_uuid.UUID]:
    if not s:
        return None
    try:
        return _uuid.UUID(s)
    except (ValueError, AttributeError):
        return None


_mcp_asgi_app = None


def create_mcp_app():
    global _mcp_asgi_app
    _mcp_asgi_app = _mcp.streamable_http_app()
    return _mcp_asgi_app


@asynccontextmanager
async def mcp_lifespan() -> AsyncIterator[None]:
    async with _mcp.session_manager.run():
        yield
