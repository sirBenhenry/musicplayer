"""Prowlarr search client."""
import logging
from typing import Optional

import httpx

from ..core.config import get_settings

settings = get_settings()
log = logging.getLogger(__name__)


async def search(query: str, categories: list[int] | None = None) -> list[dict]:
    """Search all configured indexers. Categories: 3000=audio, 3010=mp3, 3040=lossless."""
    params = {
        "query": query,
        "categories": categories or [3000],
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(
                f"{settings.PROWLARR_URL}/api/v1/search",
                params=params,
                headers={"X-Api-Key": settings.PROWLARR_KEY},
            )
            r.raise_for_status()
            return r.json()
    except Exception as e:
        log.error("Prowlarr search '%s' failed: %s", query, e)
        return []


def pick_best_result(results: list[dict]) -> Optional[dict]:
    """Prefer FLAC > MP3 320 > others. Within same quality, prefer more seeders."""
    if not results:
        return None

    def quality_rank(r: dict) -> int:
        title = (r.get("title") or "").lower()
        if "flac" in title or r.get("categories", [3000]) == [3040]:
            return 3
        if "320" in title:
            return 2
        return 1

    return max(results, key=lambda r: (quality_rank(r), r.get("seeders", 0)))
