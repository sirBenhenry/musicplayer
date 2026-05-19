"""MusicBrainz API — artist release lookup + recording (track) search."""
import asyncio
import logging

import httpx

log = logging.getLogger(__name__)

_BASE = "https://musicbrainz.org/ws/2"
_HEADERS = {"User-Agent": "musicplayer/1.0 (benhenry@gonnet.ch)"}


async def get_release_groups(mbid: str) -> list[dict]:
    """Return all release groups (albums/EPs/singles) for an artist MBID.

    Each entry: {id, title, primary-type, first-release-date}
    Handles pagination; respects 1 req/sec rate limit.
    """
    results: list[dict] = []
    offset = 0
    limit = 100

    async with httpx.AsyncClient(timeout=30, headers=_HEADERS) as client:
        while True:
            try:
                r = await client.get(
                    f"{_BASE}/release-group",
                    params={
                        "artist": mbid,
                        "type": "album|ep|single",
                        "fmt": "json",
                        "limit": limit,
                        "offset": offset,
                    },
                )
                r.raise_for_status()
                data = r.json()
            except Exception as e:
                log.error("MusicBrainz get_release_groups(%s) failed: %s", mbid, e)
                break

            groups = data.get("release-groups", [])
            results.extend(groups)
            total = data.get("release-group-count", 0)

            if offset + limit >= total:
                break
            offset += limit
            await asyncio.sleep(1.1)  # MusicBrainz rate limit

    log.info("MusicBrainz: %d release groups for %s", len(results), mbid)
    return results


async def search_recordings(query: str, limit: int = 20) -> list[dict]:
    """Search MusicBrainz recordings by title/artist.

    Accepts plain text or "artist - title" format.
    Returns list of {title, artist, album} dicts.
    """
    # Build lucene query when user provides "artist - title" or "title artist" patterns
    parts = [p.strip() for p in query.split(" - ", 1)]
    if len(parts) == 2:
        mb_query = f'artist:"{parts[0]}" AND recording:"{parts[1]}"'
    else:
        mb_query = query
    try:
        async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as client:
            r = await client.get(
                f"{_BASE}/recording",
                params={"query": mb_query, "fmt": "json", "limit": limit},
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        log.error("MusicBrainz search_recordings(%r) failed: %s", query, e)
        return []

    results = []
    for rec in data.get("recordings", []):
        title = rec.get("title", "")
        credits = rec.get("artist-credit", [])
        artist = credits[0].get("name", "") if credits else ""
        releases = rec.get("releases", [])
        album = releases[0].get("title", "") if releases else ""
        if title and artist:
            results.append({"title": title, "artist": artist, "album": album})

    return results
