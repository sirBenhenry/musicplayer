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


_LIVE_PATTERNS = (
    " live", "(live", "live at ", "live in ", "live from ",
    "live version", "concert version", "- live", "live recording",
)
_REMIX_PATTERNS = (
    " remix", "(remix", "- remix", " rmx", "(rmx",
    "rework", "re-edit", "club mix", "dub mix", "extended mix",
    "bootleg mix", "radio mix", "instrumental mix",
)
_JUNK_PATTERNS = (
    "instrumental", "karaoke", "backing track", "minus one",
    "a cappella", "acapella",
)


def _title_matches(title: str, patterns: tuple) -> bool:
    t = title.lower()
    return any(p in t for p in patterns)


async def search_recordings(
    query: str,
    limit: int = 30,
    search_filter: str = "all",
) -> list[dict]:
    """Search MusicBrainz recordings.

    search_filter: 'all' | 'no_live' | 'no_remixes' | 'studio'
      studio = no live + no remixes + official releases only
    """
    query = query.strip()

    def _esc(s: str) -> str:
        return s.replace('"', '\\"')

    parts = [p.strip() for p in query.split(" - ", 1)]
    if len(parts) == 2 and parts[0] and parts[1]:
        # "A - B" is usually artist - title, but users type it both ways.
        a, b = _esc(parts[0]), _esc(parts[1])
        mb_query = (
            f'(recording:"{b}" AND artist:"{a}")'
            f' OR (recording:"{a}" AND artist:"{b}")'
        )
    else:
        words = [w for w in query.split() if w]
        if len(words) == 1:
            mb_query = query
        elif len(words) <= 5:
            # The user typed some mix of artist and title with no separator.
            # OR together every artist/title split (both directions) plus the
            # bare query — one MB request covers all interpretations. Bare
            # terms also match aliases/transliterations (romaji → kanji).
            clauses = [f'({" AND ".join(_esc(w) for w in words)})']
            for i in range(1, len(words)):
                head = _esc(" ".join(words[:i]))
                tail = _esc(" ".join(words[i:]))
                clauses.append(f'(artist:"{head}" AND recording:"{tail}")')
                clauses.append(f'(artist:"{tail}" AND recording:"{head}")')
            mb_query = " OR ".join(clauses)
        else:
            clauses = [f'(recording:{_esc(w)} OR artist:{_esc(w)})' for w in words]
            mb_query = ' AND '.join(clauses)

    if search_filter == "no_live":
        mb_query = f'({mb_query}) AND -type:live'
    elif search_filter == "no_remixes":
        mb_query = f'({mb_query}) AND -type:remix'
    elif search_filter == "studio":
        mb_query = f'({mb_query}) AND -type:live AND -type:remix AND status:official'

    async def _query_mb(client: httpx.AsyncClient, q: str) -> list[dict]:
        try:
            r = await client.get(
                f"{_BASE}/recording",
                params={"query": q, "fmt": "json", "limit": 100},
            )
            r.raise_for_status()
            return r.json().get("recordings", [])
        except Exception as e:
            log.error("MusicBrainz search_recordings(%r) failed: %s", q, e)
            return []

    async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as client:
        recordings = await _query_mb(client, mb_query)
        if len(recordings) < 5 and mb_query != query:
            # Structured query too strict (typo, "title - artist" order, odd
            # punctuation) — retry as a bare query across all fields.
            await asyncio.sleep(1.1)  # MB rate limit
            recordings += await _query_mb(client, query)

    exclude_live = search_filter in ("no_live", "studio")
    exclude_remixes = search_filter in ("no_remixes", "studio")

    from rapidfuzz import fuzz

    # MB's Lucene score orders by index-term match, not by what a human wants:
    # the canonical hit song routinely lands below bootlegs and covers. Re-rank
    # by fuzzy similarity to the query plus release count (popularity proxy —
    # the well-known recording appears on many releases, a bootleg on one).
    q_cmp = query.replace(" - ", " ").lower()
    seen: set[str] = set()
    scored: list[tuple[float, dict]] = []
    for rec in recordings:
        mb_score = int(rec.get("score", 0))
        recording_id = rec.get("id", "")
        if not recording_id or recording_id in seen:
            continue
        seen.add(recording_id)
        title = rec.get("title", "")
        if exclude_live and _title_matches(title, _LIVE_PATTERNS):
            continue
        if exclude_remixes and _title_matches(title, _REMIX_PATTERNS):
            continue
        # Always drop karaoke/instrumental/backing tracks
        if _title_matches(title, _JUNK_PATTERNS):
            continue
        credits = rec.get("artist-credit", [])
        artist = _build_artist_string(credits) or (credits[0].get("name", "") if credits else "")
        if not (title and artist):
            continue
        releases = rec.get("releases", []) or []
        album = releases[0].get("title", "") if releases else ""

        # Query may be "artist title" or "title artist" — take the better fit.
        sim = max(
            fuzz.WRatio(q_cmp, f"{artist} {title}".lower()),
            fuzz.WRatio(q_cmp, f"{title} {artist}".lower()),
        )
        if sim < 45 and mb_score < 60:
            continue
        official = any((r.get("status") or "").lower() == "official" for r in releases)
        rank = sim * 1.5 + min(len(releases), 20) * 3 + (15 if official else 0) + mb_score * 0.3
        if rec.get("video"):
            rank -= 35  # music-video recording, not the audio track
        # A remix/live/alternate cut only belongs on top when the user asked
        # for it — otherwise the plain recording wins the tie.
        if (_title_matches(title, _REMIX_PATTERNS) or _title_matches(title, _LIVE_PATTERNS)
                or _title_matches(title, ("demo", "acoustic", "medley", "commentary",
                                          "music video", "edit)", "version"))):
            if not any(w in q_cmp for w in ("remix", "live", "demo", "acoustic",
                                            "edit", "version", "medley")):
                rank -= 40
        scored.append((rank, {
            "title": title,
            "artist": artist,
            "album": album,
            "mb_recording_id": recording_id,
            "score": mb_score,
        }))

    # Title-only searches of much-covered songs return a wall of one-off
    # covers. The artist the user means dominates the result pool (e.g. Queen
    # is ~30 of 100 "Bohemian Rhapsody" recordings) — boost by pool frequency.
    from collections import Counter
    artist_freq = Counter(item["artist"].lower() for _r, item in scored)
    scored = [(rank + min(artist_freq[item["artist"].lower()], 30) * 1.5, item)
              for rank, item in scored]

    # Collapse duplicate (artist, title) recordings — MB has one entry per
    # master/edit and they'd otherwise crowd out everything else.
    best: dict[tuple[str, str], tuple[float, dict]] = {}
    for rank, item in scored:
        key = (item["artist"].lower(), item["title"].lower())
        if key not in best or rank > best[key][0]:
            best[key] = (rank, item)

    return [item for _rank, item in sorted(best.values(), key=lambda t: -t[0])][:limit]


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
                if not title:
                    continue
                if _title_matches(title, _JUNK_PATTERNS):
                    continue
                if _title_matches(title, _LIVE_PATTERNS):
                    continue
                credits = rec.get("artist-credit", [])
                artist = _build_artist_string(credits) or (credits[0].get("name", "") if credits else "")
                results.append({"title": title, "artist": artist, "mb_recording_id": rid})

            total = data.get("count", 0)  # MB returns "count" not "recording-count"
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
                params={"inc": "isrcs+artist-credits+releases+aliases", "fmt": "json"},
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

    canonical_title = data.get("title") or ""

    # Extract romanized alias: prefer explicit -Latn locale, fallback to any ASCII alias
    # when canonical title is non-ASCII (e.g. kanji → romaji)
    aliases = data.get("aliases", [])
    title_romanized: str | None = None
    if not canonical_title.isascii():
        _latn_locales = {"ja-Latn", "zh-Latn", "ko-Latn", "ru-Latn", "uk-Latn", "ar-Latn"}
        for a in aliases:
            if a.get("locale") in _latn_locales and a.get("name"):
                title_romanized = a["name"]
                break
        if not title_romanized:
            for a in aliases:
                name = a.get("name", "")
                if name and name != canonical_title and name.isascii():
                    title_romanized = name
                    break

    title_aliases = [
        a["name"] for a in aliases
        if a.get("name") and a["name"] != canonical_title
    ]

    return {
        "recording_id": recording_id,
        "title": canonical_title,
        "title_romanized": title_romanized,
        "title_aliases": title_aliases,
        "artist_name": artist_name,
        "artist_mbid": artist_mbid,
        "isrc": isrc,
        "release_title": release_title,
        "release_mbid": release_mbid,
    }
