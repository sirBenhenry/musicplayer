"""In-memory session queue + auto-radio next-song endpoint."""
import logging
import math
import random
from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import require_auth
from ..core.database import get_db
from ..models.library import Song
from ..models.events import SongEvent
from ..services.navidrome import stream_url

router = APIRouter(prefix="/queue", tags=["queue"])
log = logging.getLogger(__name__)

# Single-user in-memory queue
_queue: list[dict] = []
_current_index: int = 0

# ── Tuning constants ──────────────────────────────────────────────────────────
_SAME_ARTIST_PENALTY = 0.30  # score penalty for same artist
_RECENCY_HALF_LIFE_H = 4.0   # hours at which recency penalty = 0.5 * max
_RECENCY_MAX_PENALTY = 0.55  # maximum recency penalty (for very recently played)
_TEMPERATURE = 0.35           # softmax temperature (lower = more similar picks)
_SHORT_BAN_PENALTY = 10.0    # effectively infinite penalty for short-banned songs


class AppendBody(BaseModel):
    song_id: str


class NextBody(BaseModel):
    song_id: str


class ReorderBody(BaseModel):
    from_index: int
    to_index: int


@router.get("")
async def get_queue(_: str = Depends(require_auth)):
    return {"items": _queue, "current_index": _current_index}


@router.post("/append")
async def append(
    body: AppendBody,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    song = await db.get(Song, body.song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    _queue.append(_song_dict(song))
    return {"queue_length": len(_queue)}


@router.post("/next")
async def insert_next(
    body: NextBody,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    global _current_index
    song = await db.get(Song, body.song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    insert_at = _current_index + 1
    _queue.insert(insert_at, _song_dict(song))
    return {"inserted_at": insert_at}


@router.delete("/{index}")
async def remove_item(index: int, _: str = Depends(require_auth)):
    global _current_index
    if index < 0 or index >= len(_queue):
        raise HTTPException(400, "Index out of range")
    _queue.pop(index)
    if index < _current_index:
        _current_index = max(0, _current_index - 1)
    return {"queue_length": len(_queue)}


@router.put("/reorder")
async def reorder(body: ReorderBody, _: str = Depends(require_auth)):
    global _current_index
    if body.from_index < 0 or body.from_index >= len(_queue):
        raise HTTPException(400, "from_index out of range")
    if body.to_index < 0 or body.to_index >= len(_queue):
        raise HTTPException(400, "to_index out of range")
    item = _queue.pop(body.from_index)
    _queue.insert(body.to_index, item)
    return {"queue_length": len(_queue)}


# ── Auto-radio ────────────────────────────────────────────────────────────────

@router.get("/auto-radio")
async def auto_radio(
    song_id: str,
    profile_id: str | None = None,
    scope: str = "profile",
    banned_ids: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    """Return best next song using acoustic similarity + scoring. Single pick."""
    banned = set((banned_ids or "").split(",")) - {""}
    result = await _pick_next(db, song_id, profile_id, scope, banned, already_picked=set())
    if not result:
        raise HTTPException(404, "No suitable song found")
    return result


@router.get("/auto-radio-batch")
async def auto_radio_batch(
    song_id: str,
    count: int = 5,
    profile_id: str | None = None,
    scope: str = "profile",
    banned_ids: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(require_auth),
):
    """Return a chain of `count` songs (each picked from the previous).

    While playing song A, call with song_id=A to pre-compute [B, C, D, E, F].
    B is picked from A, C from B, etc. — so the chain feels natural.
    """
    count = max(1, min(count, 10))
    banned = set((banned_ids or "").split(",")) - {""}
    already_picked: set[str] = {song_id}  # exclude original seed from later chain positions

    chain: list[dict] = []
    current_id = song_id

    for _ in range(count):
        pick = await _pick_next(db, current_id, profile_id, scope, banned, already_picked)
        if not pick:
            break
        chain.append(pick)
        already_picked.add(pick["id"])
        current_id = pick["id"]

    return {"songs": chain}


# ── Core algorithm ────────────────────────────────────────────────────────────

async def _pick_next(
    db: AsyncSession,
    song_id: str,
    profile_id: str | None,
    scope: str,
    banned_ids: set[str],
    already_picked: set[str],
) -> dict | None:
    """
    Adaptive recommendation:
    1. Count profile songs → derive pool_size, recency_window, max_recent_exclusions
    2. Fetch recent plays from SongEvent (within window, capped at max_recent)
    3. Query top candidates by cosine similarity
    4. Score each: similarity - same_artist_penalty - recency_decay
    5. Softmax + weighted random pick
    """
    import uuid as _uuid

    # ── Load seed song ──────────────────────────────────────────────────────
    try:
        seed_uuid = _uuid.UUID(song_id)
    except ValueError:
        return None

    seed = await db.get(Song, seed_uuid)
    if not seed:
        return None

    use_profile = scope == "profile" and profile_id is not None

    # ── Adaptive parameters based on profile size ───────────────────────────
    profile_count = await _count_profile_songs(db, profile_id if use_profile else None)
    pool_size, recency_window_h, max_recent = _adaptive_params(profile_count)

    # ── Recent plays from SongEvent ─────────────────────────────────────────
    recency_map = await _get_recency_map(db, recency_window_h, max_recent)

    # ── Build exclusion set ─────────────────────────────────────────────────
    excluded = {str(seed.id)} | banned_ids | already_picked

    # ── Query candidates ────────────────────────────────────────────────────
    if seed.feature_vector is not None:
        candidates = await _query_by_vector(
            db, seed.feature_vector, profile_id if use_profile else None,
            excluded, pool_size * 2  # fetch double to allow filtering
        )
    else:
        candidates = await _query_random(
            db, profile_id if use_profile else None, excluded, pool_size
        )

    if not candidates:
        return None

    # ── Score candidates ────────────────────────────────────────────────────
    now = datetime.now(timezone.utc)
    scored: list[tuple[float, dict]] = []

    for c in candidates:
        # Similarity score: convert cosine distance → similarity (0..1)
        similarity = max(0.0, 1.0 - c.get("_dist", 0.5))

        # Same-artist penalty
        artist_penalty = _SAME_ARTIST_PENALTY if (
            c.get("artist_id") and seed.artist_id and
            str(c["artist_id"]) == str(seed.artist_id)
        ) else 0.0

        # Recency penalty: exponential decay
        recency_penalty = 0.0
        last_played = recency_map.get(c["id"])
        if last_played:
            hours_ago = (now - last_played).total_seconds() / 3600.0
            recency_penalty = _RECENCY_MAX_PENALTY * math.exp(-hours_ago / _RECENCY_HALF_LIFE_H)

        # Short-ban: already in banned_ids, but recency_map may have non-banned recent songs
        score = similarity - artist_penalty - recency_penalty
        scored.append((score, c))

    if not scored:
        return None

    # ── Softmax weighted pick ────────────────────────────────────────────────
    scores = [s for s, _ in scored]
    pick = _softmax_sample(scored, scores, temperature=_TEMPERATURE)

    return pick


def _adaptive_params(profile_count: int) -> tuple[int, float, int]:
    """Return (pool_size, recency_window_hours, max_recent_exclusions)."""
    if profile_count <= 20:
        # Tiny: be gentle — small pool, short window, few exclusions
        pool_size = max(8, profile_count - 1)
        recency_h = 1.0
        max_recent = 5
    elif profile_count <= 80:
        # Medium
        pool_size = min(30, int(profile_count * 0.6))
        recency_h = 3.0
        max_recent = 10
    else:
        # Large
        pool_size = min(40, int(profile_count * 0.35))
        recency_h = 5.0
        max_recent = 15
    return pool_size, recency_h, max_recent


async def _count_profile_songs(db: AsyncSession, profile_id: str | None) -> int:
    import uuid as _uuid
    if profile_id:
        try:
            pid = _uuid.UUID(profile_id)
            r = await db.execute(select(func.count()).where(Song.profile_id == pid))
        except ValueError:
            r = await db.execute(select(func.count(Song.id)))
    else:
        r = await db.execute(select(func.count(Song.id)))
    return r.scalar_one() or 1


async def _get_recency_map(
    db: AsyncSession, window_h: float, max_count: int
) -> dict[str, datetime]:
    """Return {song_id: last_played_at} for recent listen-through events."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=window_h)
    result = await db.execute(
        text("""
            SELECT song_id::text, MAX(created_at) as last_played
            FROM song_events
            WHERE event_type = 'listen_through'
              AND created_at >= :cutoff
              AND song_id IS NOT NULL
            GROUP BY song_id
            ORDER BY last_played DESC
            LIMIT :max_count
        """),
        {"cutoff": cutoff, "max_count": max_count},
    )
    rows = result.fetchall()
    return {row[0]: row[1] for row in rows}


async def _query_by_vector(
    db: AsyncSession,
    vec: list[float],
    profile_id: str | None,
    excluded_ids: set[str],
    limit: int,
) -> list[dict]:
    import uuid as _uuid

    excl_list = list(excluded_ids) if excluded_ids else ["00000000-0000-0000-0000-000000000000"]
    import numpy as _np
    vec_list = vec.tolist() if isinstance(vec, _np.ndarray) else list(vec)
    # asyncpg needs pgvector string format; cast in SQL
    vec_str = '[' + ','.join(str(float(x)) for x in vec_list) + ']'

    base_q = """
        SELECT
            s.id::text, s.navidrome_id, s.title,
            s.artist_id::text, s.album_id::text, s.duration_sec,
            s.display_artist, a.name AS artist_name,
            s.feature_vector <=> CAST(:vec AS vector) AS _dist
        FROM songs s
        LEFT JOIN artists a ON a.id = s.artist_id
        WHERE s.id::text != ALL(:excluded)
          AND s.analysed_at IS NOT NULL
          AND s.feature_vector IS NOT NULL
    """
    params: dict[str, Any] = {"vec": vec_str, "excluded": excl_list}

    if profile_id:
        try:
            pid = _uuid.UUID(profile_id)
            base_q += " AND s.profile_id = :pid"
            params["pid"] = pid
        except ValueError:
            pass

    base_q += f" ORDER BY _dist LIMIT {limit}"

    result = await db.execute(text(base_q), params)
    rows = result.fetchall()
    return [_row_to_candidate(row) for row in rows]


async def _query_random(
    db: AsyncSession,
    profile_id: str | None,
    excluded_ids: set[str],
    limit: int,
) -> list[dict]:
    import uuid as _uuid

    excl_list = list(excluded_ids) if excluded_ids else ["00000000-0000-0000-0000-000000000000"]
    base_q = """
        SELECT
            s.id::text, s.navidrome_id, s.title,
            s.artist_id::text, s.album_id::text, s.duration_sec,
            s.display_artist, a.name AS artist_name,
            0.5 AS _dist
        FROM songs s
        LEFT JOIN artists a ON a.id = s.artist_id
        WHERE s.id::text != ALL(:excluded)
    """
    params: dict[str, Any] = {"excluded": excl_list}

    if profile_id:
        try:
            pid = _uuid.UUID(profile_id)
            base_q += " AND s.profile_id = :pid"
            params["pid"] = pid
        except ValueError:
            pass

    base_q += f" ORDER BY RANDOM() LIMIT {limit}"
    result = await db.execute(text(base_q), params)
    rows = result.fetchall()
    return [_row_to_candidate(row) for row in rows]


def _row_to_candidate(row) -> dict:
    artist_name = row[7] or row[6] or ""  # artist_name from JOIN, fallback display_artist
    return {
        "id": row[0],
        "navidrome_id": row[1],
        "title": row[2],
        "artist_id": row[3],
        "album_id": row[4],
        "duration_sec": row[5],
        "artist": artist_name,
        "artist_name": artist_name,
        "_dist": float(row[8]),
    }


def _softmax_sample(scored: list[tuple[float, dict]], scores: list[float], temperature: float) -> dict:
    """Weighted random pick using softmax over scores."""
    if temperature <= 0 or len(scored) == 1:
        return max(scored, key=lambda x: x[0])[1]

    # Shift scores for numerical stability
    max_s = max(scores)
    exp_scores = [math.exp((s - max_s) / temperature) for s in scores]
    total = sum(exp_scores)
    if total <= 0:
        return scored[0][1]
    weights = [e / total for e in exp_scores]

    chosen = random.choices(scored, weights=weights, k=1)[0]
    return chosen[1]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _song_dict(song: Song) -> dict:
    artist_name = ""
    if hasattr(song, "artist") and song.artist:
        artist_name = song.artist.name
    elif song.display_artist:
        artist_name = song.display_artist
    return {
        "id": str(song.id),
        "navidrome_id": song.navidrome_id,
        "title": song.title,
        "artist": artist_name,
        "artist_name": artist_name,
        "artist_id": str(song.artist_id) if song.artist_id else None,
        "album_id": str(song.album_id) if song.album_id else None,
        "duration_sec": song.duration_sec,
    }
