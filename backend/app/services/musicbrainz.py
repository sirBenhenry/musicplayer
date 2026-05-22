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


def _build_artist_string(credits: list) -> str:
    """Build full display artist string from artist-credit list."""
    parts = []
    for c in credits:
        if isinstance(c, dict):
            name = c.get("name") or c.get("artist", {}).get("name", "")
            if name:
                parts.append(name)
            joinphrase = c.get("joinphrase", "")
            if joinphrase:
                parts.append(joinphrase)
    return "".join(parts).strip(" ,&") or ""


_LIVE_TITLE_PATTERNS = (
    " live", "(live", "live at ", "live in ", "live from ", "live version",
    "concert version", "- live", "live recording",
)


def _is_live_title(title: str) -> bool:
    t = title.lower()
    return any(p in t for p in _LIVE_TITLE_PATTERNS)


async def search_recordings(query: str, limit: int = 30, exclude_live: bool = False) -> list[dict]:
    """Search MusicBrainz recordings. Accepts plain text or 'artist - title'.

    Plain text ≤3 words: phrase search in title. 4+ words: per-word cross-field
    (recording OR artist) so "beat it jackson" finds MJ's Beat It.
    exclude_live: appends -type:live to MB query + filters live-sounding titles.
    Filters score < 40, deduplicates by recording ID.
    Returns [{title, artist, album, mb_recording_id}].
    """
    query = query.strip()
    parts = [p.strip() for p in query.split(" - ", 1)]
    if len(parts) == 2 and parts[0] and parts[1]:
        mb_query = f'recording:"{parts[1]}" AND artist:"{parts[0]}"'
    else:
        words = [w for w in query.split() if w]
        if len(words) <= 3:
            mb_query = f'recording:"{query}"'
        else:
            clauses = [f'(recording:{w} OR artist:{w})' for w in words]
            mb_query = ' AND '.join(clauses)

    if exclude_live:
        mb_query = f'({mb_query}) AND -type:live'

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

    seen: set[str] = set()
    results = []
    for rec in data.get("recordings", []):
        score = int(rec.get("score", 0))
        if score < 40:
            continue
        recording_id = rec.get("id", "")
        if not recording_id or recording_id in seen:
            continue
        seen.add(recording_id)
        title = rec.get("title", "")
        if exclude_live and _is_live_title(title):
            continue
        credits = rec.get("artist-credit", [])
        artist = _build_artist_string(credits) or (credits[0].get("name", "") if credits else "")
        releases = rec.get("releases", [])
        album = releases[0].get("title", "") if releases else ""
        if title and artist:
            results.append({
                "title": title,
                "artist": artist,
                "album": album,
                "mb_recording_id": recording_id,
            })

    return results


async def get_artist_recordings(artist_mbid: str, max_recordings: int = 500) -> list[dict]:
    """Fetch all recordings where artist has a credit (including features).

    Uses arid:{mbid} Lucene query which matches any credit role.
    Paginates up to max_recordings. Deduplicates by recording ID.
    Returns [{title, artist, mb_recording_id}].
    """
    results: list[dict] = []
    seen: set[str] = set()
    offset = 0
    limit = 100

    async with httpx.AsyncClient(timeout=30, headers=_HEADERS) as client:
        while len(results) < max_recordings:
            try:
                r = await client.get(
                    f"{_BASE}/recording",
                    params={
                        "query": f"arid:{artist_mbid}",
                        "fmt": "json",
                        "limit": limit,
                        "offset": offset,
                    },
                )
                r.raise_for_status()
                data = r.json()
            except Exception as e:
                log.error("MusicBrainz get_artist_recordings(%s) failed at offset %d: %s", artist_mbid, offset, e)
                break

            recordings = data.get("recordings", [])
            if not recordings:
                break

            for rec in recordings:
                rid = rec.get("id", "")
                if not rid or rid in seen:
                    continue
                seen.add(rid)
                title = rec.get("title", "")
                credits = rec.get("artist-credit", [])
                artist = _build_artist_string(credits) or (credits[0].get("name", "") if credits else "")
                if title:
                    results.append({"title": title, "artist": artist, "mb_recording_id": rid})

            total = data.get("recording-count", 0)
            offset += limit
            if offset >= min(total, max_recordings):
                break
            await asyncio.sleep(1.1)

    log.info("MusicBrainz: %d recordings for artist %s", len(results), artist_mbid)
    return results


async def get_recording(recording_id: str) -> dict:
    """Fetch full recording details from MusicBrainz including ISRC and artist MBID.

    Returns: {recording_id, title, artist_name, artist_mbid, isrc, release_title, release_mbid}
    """
    try:
        async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as client:
            r = await client.get(
                f"{_BASE}/recording/{recording_id}",
                params={"inc": "isrcs+artist-credits+releases", "fmt": "json"},
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        log.error("MusicBrainz get_recording(%s) failed: %s", recording_id, e)
        return {}

    credits = data.get("artist-credit", [])
    artist_name = credits[0].get("name", "") if credits else ""
    artist_mbid = ""
    if credits and isinstance(credits[0], dict):
        artist_obj = credits[0].get("artist", {})
        artist_mbid = artist_obj.get("id", "")

    isrcs = data.get("isrcs", [])
    isrc = isrcs[0] if isrcs else None

    releases = data.get("releases", [])
    release_title = releases[0].get("title", "") if releases else ""
    release_mbid = releases[0].get("id", "") if releases else ""

    return {
        "recording_id": recording_id,
        "title": data.get("title", ""),
        "artist_name": artist_name,
        "artist_mbid": artist_mbid,
        "isrc": isrc,
        "release_title": release_title,
        "release_mbid": release_mbid,
    }
