"""Playlist 3 — New Genre: LLM picks a genre not in recent history, curates 10 tracks."""
import json
import logging

from ..services.llm import LLMProvider

log = logging.getLogger(__name__)

SYSTEM = (
    "You are a music curator with encyclopaedic genre knowledge. "
    "Return only valid JSON — no markdown, no prose."
)


async def generate(
    genre_history: list[str],
    llm: LLMProvider,
) -> dict:
    """Return {genre: str, tracks: [{artist, title}, ...]} with ~10 tracks."""
    history_str = ", ".join(genre_history[-30:]) if genre_history else "none"

    prompt = (
        f"Recent genres already used (do NOT repeat): {history_str}\n\n"
        "1. Choose one genre not in that list — it can be niche, geographic, or fusion.\n"
        "2. Curate exactly 10 representative tracks from that genre — a mix of seminal classics "
        "and hidden gems.\n\n"
        "Return JSON: {\"genre\": \"...\", \"tracks\": [{\"artist\": \"...\", \"title\": \"...\"}]}"
    )

    try:
        raw = await llm.complete(
            [{"role": "user", "content": prompt}],
        )
        return _parse(raw)
    except Exception as e:
        log.error("new_genre LLM call failed: %s", e)
        return {}


def _parse(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        data = json.loads(raw)
        if isinstance(data, dict) and "genre" in data and "tracks" in data:
            return {
                "genre": data["genre"],
                "tracks": [
                    {"artist": t["artist"], "title": t["title"]}
                    for t in data["tracks"]
                    if "artist" in t and "title" in t
                ],
            }
    except Exception:
        pass
    return {}
