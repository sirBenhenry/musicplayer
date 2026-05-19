"""ListenBrainz client — scrobbling + similar artists."""
import logging
import time
from typing import Optional

import httpx

from ..core.config import get_settings

settings = get_settings()
BASE = "https://api.listenbrainz.org"
log = logging.getLogger(__name__)


def _headers() -> dict:
    return {"Authorization": f"Token {settings.LISTENBRAINZ_TOKEN}"}


async def submit_listen(title: str, artist: str, duration_sec: Optional[int] = None) -> None:
    if not settings.LISTENBRAINZ_TOKEN:
        return
    payload = {
        "listen_type": "single",
        "payload": [{
            "listened_at": int(time.time()),
            "track_metadata": {
                "track_name": title,
                "artist_name": artist,
                **({"additional_info": {"duration_ms": duration_sec * 1000}} if duration_sec else {}),
            },
        }],
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(f"{BASE}/1/submit-listens", json=payload, headers=_headers())
            if r.status_code not in (200, 204):
                log.warning("ListenBrainz submit failed: %s %s", r.status_code, r.text)
    except Exception as e:
        log.warning("ListenBrainz submit error: %s", e)


async def get_similar_artists(artist_name: str, count: int = 30) -> list[dict]:
    """Get similar artists. ListenBrainz is stronger for niche artists."""
    try:
        # First resolve to MBID via MusicBrainz
        mbid = await _get_mbid(artist_name)
        if not mbid:
            return []
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{BASE}/1/metadata/similar-artists/",
                params={"artist_mbid": mbid, "count": count},
            )
            if r.status_code == 200:
                return r.json().get("similar_artists", [])
    except Exception as e:
        log.warning("ListenBrainz similar artists for %s: %s", artist_name, e)
    return []


async def _get_mbid(artist_name: str) -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://musicbrainz.org/ws/2/artist/",
                params={"query": artist_name, "limit": 1, "fmt": "json"},
                headers={"User-Agent": "MusicApp/0.1 (benhenry@gonnet.ch)"},
            )
            artists = r.json().get("artists", [])
            if artists:
                return artists[0].get("id")
    except Exception:
        pass
    return None
