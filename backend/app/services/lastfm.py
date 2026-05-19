"""Last.fm API client (read-only, no OAuth needed)."""
import hashlib
import logging
from typing import Optional

import httpx

from ..core.config import get_settings

settings = get_settings()
BASE = "https://ws.audioscrobbler.com/2.0/"
log = logging.getLogger(__name__)


async def _call(method: str, **params) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(BASE, params={
            "method": method,
            "api_key": settings.LASTFM_API_KEY,
            "format": "json",
            **params,
        })
        r.raise_for_status()
        return r.json()


async def get_similar_artists(artist_name: str, limit: int = 50) -> list[dict]:
    try:
        data = await _call("artist.getSimilar", artist=artist_name, limit=limit, autocorrect=1)
        return data.get("similarartists", {}).get("artist", [])
    except Exception as e:
        log.warning("Last.fm similar artists for %s: %s", artist_name, e)
        return []


async def get_top_tracks(artist_name: str, limit: int = 10) -> list[dict]:
    try:
        data = await _call("artist.getTopTracks", artist=artist_name, limit=limit, autocorrect=1)
        return data.get("toptracks", {}).get("track", [])
    except Exception as e:
        log.warning("Last.fm top tracks for %s: %s", artist_name, e)
        return []


async def get_artist_info(artist_name: str) -> dict:
    try:
        data = await _call("artist.getInfo", artist=artist_name, autocorrect=1)
        return data.get("artist", {})
    except Exception:
        return {}
