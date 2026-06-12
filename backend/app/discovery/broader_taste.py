"""Playlist 2 — Broader Taste: one step outside profile's core sound."""
import json
import logging

from ..services import lastfm, listenbrainz
from ..services.llm import LLMProvider
from .close_match import _parse, _sample_artists, _fetch_candidates

log = logging.getLogger(__name__)


async def generate(
    profile: dict,
    profile_songs: list[dict],
    library_artists: list[str],
    rejected: list[dict],
    llm: LLMProvider,
) -> list[dict]:
    """Return up to 9 tracks for Playlist 2 (broader taste, slightly adventurous)."""
    seed_artists = _sample_artists(profile_songs, library_artists, n=10)
    candidates = await _fetch_candidates(seed_artists, library_artists, rejected)

    rejected_str = ", ".join(f"{r['artist']} - {r['title']}" for r in rejected[:50])

    if not candidates:
        log.info("broader_taste: no Last.fm candidates, falling back to LLM-only")
        liked_str = json.dumps(profile_songs[:40], indent=2)
        prompt = (
            f"Profile: {profile['name']} — {profile.get('description', '')}\n\n"
            f"Songs the user already likes:\n{liked_str}\n\n"
            f"Do NOT include: {rejected_str or 'none'}\n\n"
            "Based on this taste, suggest exactly 9 tracks that are one step outside "
            "the profile's core sound — adventurous but still appealing. Pick artists "
            "NOT in the list above that the user likely hasn't discovered yet.\n"
            "Return JSON array: [{\"artist\": \"...\", \"title\": \"...\"}]"
        )
    else:
        prompt = (
            f"Profile: {profile['name']} — {profile.get('description', '')}\n\n"
            f"Candidate artists/tracks:\n{json.dumps(candidates[:80], indent=2)}\n\n"
            f"Already heard / rejected (do NOT include): {rejected_str or 'none'}\n\n"
            "Select exactly 9 tracks that are one step outside the profile's core sound — "
            "adventurous but still appealing. Favour artists the user likely hasn't discovered yet.\n"
            "Return JSON array only: [{\"artist\": \"...\", \"title\": \"...\"}]. No markdown, no commentary."
        )

    try:
        raw = await llm.complete([{"role": "user", "content": prompt}])
        return _parse(raw)
    except Exception as e:
        log.error("broader_taste LLM call failed: %s", e)
        return []
