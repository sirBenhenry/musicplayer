"""Navidrome Subsonic API client (async)."""
import hashlib
import secrets
from typing import Any

import httpx

from ..core.config import get_settings

settings = get_settings()


def _auth_params() -> dict[str, str]:
    salt = secrets.token_hex(6)
    token = hashlib.md5(f"{settings.NAVIDROME_PASS}{salt}".encode()).hexdigest()
    return {
        "u": settings.NAVIDROME_USER,
        "t": token,
        "s": salt,
        "v": "1.16.1",
        "c": "musicapp",
        "f": "json",
    }


async def _get(endpoint: str, **params) -> dict[str, Any]:
    url = f"{settings.NAVIDROME_URL}/rest/{endpoint}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, params={**_auth_params(), **params})
        r.raise_for_status()
        data = r.json()
    resp = data.get("subsonic-response", {})
    if resp.get("status") != "ok":
        raise RuntimeError(f"Subsonic error: {resp.get('error', {})}")
    return resp


async def get_artists() -> list[dict]:
    resp = await _get("getArtists")
    index = resp.get("artists", {}).get("index", [])
    artists = []
    for idx in index:
        for a in idx.get("artist", []):
            artists.append(a)
    return artists


async def get_artist(artist_id: str) -> dict:
    resp = await _get("getArtist", id=artist_id)
    return resp.get("artist", {})


async def get_album(album_id: str) -> dict:
    resp = await _get("getAlbum", id=album_id)
    return resp.get("album", {})


async def get_albums(album_list_type: str = "newest", size: int = 500) -> list[dict]:
    resp = await _get("getAlbumList2", type=album_list_type, size=size)
    return resp.get("albumList2", {}).get("album", [])


async def search(query: str, artist_count: int = 0, album_count: int = 0, song_count: int = 20) -> dict:
    resp = await _get(
        "search3",
        query=query,
        artistCount=artist_count,
        albumCount=album_count,
        songCount=song_count,
    )
    return resp.get("searchResult3", {})


def stream_url(navidrome_id: str) -> str:
    """Return a direct Subsonic stream URL for the client (not proxied)."""
    import urllib.parse
    params = {**_auth_params(), "id": navidrome_id, "format": "raw"}
    qs = urllib.parse.urlencode(params)
    return f"{settings.NAVIDROME_URL}/rest/stream?{qs}"


def cover_art_url(navidrome_id: str, size: int = 300) -> str:
    """Return Navidrome getCoverArt URL for the given ID."""
    import urllib.parse
    params = {**_auth_params(), "id": navidrome_id, "size": size}
    qs = urllib.parse.urlencode(params)
    return f"{settings.NAVIDROME_URL}/rest/getCoverArt?{qs}"


async def trigger_scan() -> None:
    """Ask Navidrome to rescan the music folder."""
    await _get("startScan")
