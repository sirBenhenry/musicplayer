"""Playlist 1 — Close Match: artists similar to current profile library."""
import json
import logging
import random

from ..services import lastfm, listenbrainz
from ..services.llm import LLMProvider

log = logging.getLogger(__name__)

SYSTEM = (
    "You are a music curator. Given a taste profile and a list of candidate tracks, "
    "return a JSON array of exactly 9 tracks the user has NOT heard before, matching "
    "their established taste closely. "
    "Format: [{\"artist\": \"...\", \"title\": \"...\"}]. No markdown, no commentary."
)


async def generate(
    profile: dict,
    profile_songs: list[dict],
    library_artists: list[str],
    rejected: list[dict],
    llm: LLMProvider,
) -> list[dict]:
    """Return up to 9 tracks for Playlist 1 (close match)."""
    seed_artists = _sample_artists(profile_songs, library_artists, n=10)
    candidates = await _fetch_candidates(seed_artists, library_artists, rejected)

    rejected_str = ", ".join(f"{r['artist']} - {r['title']}" for r in rejected[:50])

    if not candidates:
        log.info("close_match: no Last.fm candidates, falling back to LLM-only")
        liked_str = json.dumps(profile_songs[:40], indent=2)
        prompt = (
            f"Profile: {profile['name']} — {profile.get('description', '')}\n\n"
            f"Songs the user already likes:\n{liked_str}\n\n"
            f"Do NOT include: {rejected_str or 'none'}\n\n"
            "Based on this taste, suggest exactly 9 tracks by artists NOT in the list above "
            "that the user would love. Pick tracks that closely match the established sound.\n"
            "Return JSON array: [{\"artist\": \"...\", \"title\": \"...\"}]"
        )
    else:
        prompt = (
            f"Profile: {profile['name']} — {profile.get('description', '')}\n\n"
            f"Candidate artists/tracks to draw from:\n{json.dumps(candidates[:80], indent=2)}\n\n"
            f"Already heard / rejected (do NOT include): {rejected_str or 'none'}\n\n"
            "Select exactly 9 tracks that fit this profile's sound closely.\n"
            "Return JSON array only: [{\"artist\": \"...\", \"title\": \"...\"}]. No markdown, no commentary."
        )

    try:
        raw = await llm.complete([
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ])
        return _parse(raw)
    except Exception as e:
        log.error("close_match LLM call failed: %s", e)
        return []


def _sample_artists(profile_songs: list[dict], library_artists: list[str], n: int) -> list[str]:
    seen: dict[str, int] = {}
    for s in profile_songs:
        a = s.get("artist_name") or s.get("artist", "")
        if a:
            seen[a] = seen.get(a, 0) + 1
    by_count = sorted(seen.items(), key=lambda x: -x[1])
    top = [a for a, _ in by_count[:n]]
    if len(top) < n:
        extras = [a for a in library_artists if a not in seen]
        top += random.sample(extras, min(n - len(top), len(extras)))
    return top


async def _fetch_candidates(
    seed_artists: list[str],
    library_artists: list[str],
    rejected: list[dict],
) -> list[dict]:
    rejected_set = {(r["artist"].lower(), r["title"].lower()) for r in rejected}
    library_set = {a.lower() for a in library_artists}
    candidates: list[dict] = []

    for artist in seed_artists[:8]:
        similar_lf = await lastfm.get_similar_artists(artist, limit=20)
        similar_lb = await listenbrainz.get_similar_artists(artist, count=20)

        for s in similar_lf:
            name = s.get("name", "")
            if name.lower() not in library_set:
                top = await lastfm.get_top_tracks(name, limit=3)
                for t in top:
                    entry = {"artist": name, "title": t.get("name", "")}
                    if (name.lower(), entry["title"].lower()) not in rejected_set:
                        candidates.append(entry)

        for s in similar_lb:
            name = s.get("artist_name") or s.get("name", "")
            if name and name.lower() not in library_set:
                top = await lastfm.get_top_tracks(name, limit=2)
                for t in top:
                    entry = {"artist": name, "title": t.get("name", "")}
                    if (name.lower(), entry["title"].lower()) not in rejected_set:
                        candidates.append(entry)

    return _dedup(candidates)


def _dedup(items: list[dict]) -> list[dict]:
    seen: set[tuple] = set()
    out = []
    for item in items:
        key = (item["artist"].lower(), item["title"].lower())
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


def _parse(raw: str) -> list[dict]:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [{"artist": t["artist"], "title": t["title"]} for t in data if "artist" in t and "title" in t]
    except Exception:
        pass
    return []
