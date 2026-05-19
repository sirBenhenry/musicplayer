"""Playlist 4 — Artist of the Day: one new artist, 6 tracks."""
import json
import logging
import random

from ..services import lastfm, listenbrainz
from ..services.llm import LLMProvider
from .close_match import _sample_artists

log = logging.getLogger(__name__)


async def generate(
    profile: dict,
    profile_songs: list[dict],
    library_artists: list[str],
    rejected: list[dict],
    llm: LLMProvider,
) -> dict:
    """Return {artist: str, tracks: [{artist, title}, ...]} with 6 tracks."""
    seed_artists = _sample_artists(profile_songs, library_artists, n=8)
    library_set = {a.lower() for a in library_artists}
    candidates: list[str] = []

    for artist in seed_artists[:6]:
        similar_lf = await lastfm.get_similar_artists(artist, limit=15)
        similar_lb = await listenbrainz.get_similar_artists(artist, count=15)
        for s in similar_lf:
            name = s.get("name", "")
            if name and name.lower() not in library_set:
                candidates.append(name)
        for s in similar_lb:
            name = s.get("artist_name") or s.get("name", "")
            if name and name.lower() not in library_set:
                candidates.append(name)

    # deduplicate while preserving order
    seen: set[str] = set()
    unique_candidates: list[str] = []
    for c in candidates:
        if c.lower() not in seen:
            seen.add(c.lower())
            unique_candidates.append(c)

    if not unique_candidates:
        return {}

    rejected_artists = {r["artist"].lower() for r in rejected}
    unique_candidates = [c for c in unique_candidates if c.lower() not in rejected_artists]

    prompt = (
        f"Profile: {profile['name']} — {profile.get('description', '')}\n\n"
        f"Candidate artists (all outside user's library):\n{json.dumps(unique_candidates[:60])}\n\n"
        "Pick ONE artist the user would love. Suggest exactly 6 of their best tracks "
        "(mix of accessible and deeper cuts).\n\n"
        "Return JSON: {\"artist\": \"...\", \"tracks\": [{\"artist\": \"...\", \"title\": \"...\"}]}"
    )

    try:
        raw = await llm.complete([{"role": "user", "content": prompt}])
        return _parse_aod(raw)
    except Exception as e:
        log.error("artist_of_day LLM call failed: %s", e)
        return {}


def _parse_aod(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        data = json.loads(raw)
        if isinstance(data, dict) and "artist" in data and "tracks" in data:
            return {
                "artist": data["artist"],
                "tracks": [
                    {"artist": t.get("artist", data["artist"]), "title": t["title"]}
                    for t in data["tracks"]
                    if "title" in t
                ],
            }
    except Exception:
        pass
    return {}
