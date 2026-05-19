"""Lidarr API client for artist monitoring."""
import logging
from typing import Optional

import httpx

from ..core.config import get_settings

settings = get_settings()
log = logging.getLogger(__name__)


def _headers() -> dict:
    return {"X-Api-Key": settings.LIDARR_KEY, "Content-Type": "application/json"}


async def add_artist_to_lidarr(name: str, mbid: str) -> Optional[int]:
    """Add an artist to Lidarr by MusicBrainz ID. Returns Lidarr artist ID."""
    payload = {
        "artistName": name,
        "foreignArtistId": mbid,
        "qualityProfileId": 1,
        "metadataProfileId": 1,
        "monitored": True,
        "monitorNewItems": "all",
        "rootFolderPath": "/data/music/media/music",
        "addOptions": {"monitor": "future", "searchForMissingAlbums": False},
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{settings.LIDARR_URL}/api/v1/artist",
                json=payload,
                headers=_headers(),
            )
            if r.status_code in (200, 201):
                return r.json().get("id")
            if r.status_code == 400:
                # Already exists — look it up
                return await get_artist_id_by_mbid(mbid)
            log.warning("Lidarr add_artist returned %s: %s", r.status_code, r.text)
            return None
    except Exception as e:
        log.error("Lidarr add_artist error: %s", e)
        return None


async def remove_artist_from_lidarr(lidarr_id: int) -> None:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.delete(
                f"{settings.LIDARR_URL}/api/v1/artist/{lidarr_id}",
                params={"deleteFiles": False},
                headers=_headers(),
            )
    except Exception as e:
        log.error("Lidarr remove_artist error: %s", e)


async def get_artist_id_by_mbid(mbid: str) -> Optional[int]:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{settings.LIDARR_URL}/api/v1/artist", headers=_headers())
            for a in r.json():
                if a.get("foreignArtistId") == mbid:
                    return a["id"]
    except Exception as e:
        log.error("Lidarr get_artist error: %s", e)
    return None
