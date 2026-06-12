"""Resolve artist+title → MusicBrainz recording ID before queuing downloads.

Searches MB with studio filter (no live/remix) and a high-confidence score
threshold so only verified results gate the identity check in the pipeline.
"""
import logging

from .musicbrainz import search_recordings

log = logging.getLogger(__name__)

_MIN_SCORE = 80


async def resolve_recording(artist: str, title: str) -> str | None:
    """Return mb_recording_id for the best confident match, or None.

    Requires MB internal score ≥ 80.  Caller is responsible for spacing
    calls ≥1.1s apart when resolving many tracks in a batch (MB rate limit).
    """
    query = f"{artist} - {title}"
    try:
        results = await search_recordings(query, limit=5, search_filter="studio")
        if not results:
            log.debug("mb_resolver: no studio results for %r", query)
            return None
        best = results[0]
        score = best.get("score", 0)
        if score < _MIN_SCORE:
            log.debug("mb_resolver: score %d < %d for %r", score, _MIN_SCORE, query)
            return None
        mb_id = best.get("mb_recording_id")
        log.info("mb_resolver: %r → %s (score=%d)", query, mb_id, score)
        return mb_id
    except Exception as exc:
        log.warning("mb_resolver: failed for %r: %s", query, exc)
        return None
