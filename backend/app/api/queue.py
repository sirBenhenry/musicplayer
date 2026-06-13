"""Auto-radio next-song endpoint (acoustic similarity + scoring).

The playback queue itself lives client-side in RNTP; the old server-side
in-memory queue endpoints were dead (and crashed on lazy artist load) — removed.
"""
import asyncio
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

router = APIRouter(prefix="/queue", tags=["queue"])
log = logging.getLogger(__name__)

# ── Tuning constants ──────────────────────────────────────────────────────────
_SAME_ARTIST_PENALTY = 0.30  # score penalty for same artist
_RECENCY_HALF_LIFE_H = 4.0   # hours at which recency penalty = 0.5 * max
_RECENCY_MAX_PENALTY = 0.55  # maximum recency penalty (for very recently played)
_TEMPERATURE = 0.05           # softmax temperature — tight with 1280-dim cosine embeddings
_SHORT_BAN_PENALTY = 10.0    # effectively infinite penalty for short-banned songs


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

    # ── Query candidates (vector-only — no random fallback) ─────────────────
    if seed.feature_vector is None:
        # Trigger background analysis for this song so it's ready next time
        asyncio.create_task(_analyse_one(str(seed.id)))
        return None

    candidates = await _query_by_vector(
        db, seed.feature_vector, profile_id if use_profile else None,
        excluded, pool_size * 2, seed_mode=seed.key_mode, seed_bpm=seed.bpm
    )

    # If filtered pool is too small, retry without BPM/mode filters
    if len(candidates) < 5:
        candidates = await _query_by_vector(
            db, seed.feature_vector, profile_id if use_profile else None,
            excluded, pool_size * 2
        )

    if not candidates:
        return None

    # ── Score candidates ────────────────────────────────────────────────────
    now = datetime.now(timezone.utc)
    scored: list[tuple[float, dict]] = []

    seed_bpm = seed.bpm
    seed_mode = seed.key_mode
    seed_moods = _seed_mood_vec(seed)

    for c in candidates:
        # Cosine distance 0-2 → similarity 0-1 (embeddings are L2-normalised)
        cosine_sim = max(0.0, 1.0 - c.get("_dist", 1.0))

        # BPM compatibility: linear falloff, 0 at ±20 BPM (null-safe)
        bpm_compat = _bpm_compat(seed_bpm, c.get("bpm"))

        # Mode match: 1.0 same, 0.5 null, 0.0 different
        mode_compat = _mode_compat(seed_mode, c.get("key_mode"))

        # Mood cosine similarity (null-safe)
        mood_compat = _mood_compat(seed_moods, c)

        # Vibe compat: beat_strength + spectral_centroid + dyn_complexity
        vibe_compat = _vibe_compat(seed, c)

        # Weighted hybrid score
        acoustic_sim = (
            0.50 * cosine_sim
            + 0.20 * bpm_compat
            + 0.15 * mode_compat
            + 0.15 * vibe_compat
        )

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

        score = acoustic_sim - artist_penalty - recency_penalty
        scored.append((score, c))

    if not scored:
        return None

    # ── Softmax weighted pick ────────────────────────────────────────────────
    scores = [s for s, _ in scored]
    pick = _softmax_sample(scored, scores, temperature=_TEMPERATURE)

    return pick


def _bpm_compat(seed_bpm: float | None, cand_bpm: float | None) -> float:
    """Linear BPM compatibility, 1.0 at same BPM, 0.0 at ±20 BPM difference."""
    if seed_bpm is None or cand_bpm is None:
        return 0.5
    diff = abs(seed_bpm - cand_bpm)
    # Also check half/double tempo (e.g. 120 vs 60)
    diff_half = abs(seed_bpm - cand_bpm * 2)
    diff_double = abs(seed_bpm * 2 - cand_bpm)
    diff = min(diff, diff_half, diff_double)
    return max(0.0, 1.0 - diff / 12.0)


def _mode_compat(seed_mode: str | None, cand_mode: str | None) -> float:
    if seed_mode is None or cand_mode is None:
        return 0.5
    return 1.0 if seed_mode == cand_mode else 0.0


def _seed_mood_vec(seed) -> list[float] | None:
    moods = [seed.mood_happy, seed.mood_sad, seed.mood_aggressive,
             seed.mood_relaxed, seed.mood_party]
    if all(m is None for m in moods):
        return None
    return [m or 0.0 for m in moods]


def _mood_compat(seed_moods: list[float] | None, c: dict) -> float:
    if seed_moods is None:
        return 0.5
    cand = [c.get("mood_happy"), c.get("mood_sad"), c.get("mood_aggressive"),
            c.get("mood_relaxed"), c.get("mood_party")]
    if all(m is None for m in cand):
        return 0.5
    import math as _math
    c_vec = [m or 0.0 for m in cand]
    dot = sum(a * b for a, b in zip(seed_moods, c_vec))
    norm_s = _math.sqrt(sum(x * x for x in seed_moods)) or 1e-8
    norm_c = _math.sqrt(sum(x * x for x in c_vec)) or 1e-8
    return max(0.0, dot / (norm_s * norm_c))


def _vibe_compat(seed, c: dict) -> float:
    """beat_strength (60%) + spectral_centroid (40%). dyn_complexity excluded — saturates at 1.0."""
    bs_s = getattr(seed, "beat_strength", None)
    bs_c = c.get("beat_strength")
    sc_s = getattr(seed, "spectral_centroid", None)
    sc_c = c.get("spectral_centroid")
    if bs_s is not None and bs_c is not None and sc_s is not None and sc_c is not None:
        return 0.6 * max(0.0, 1.0 - abs(bs_s - bs_c)) + 0.4 * max(0.0, 1.0 - abs(sc_s - sc_c))
    if bs_s is not None and bs_c is not None:
        return max(0.0, 1.0 - abs(bs_s - bs_c))
    return 0.5


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
    seed_mode: str | None = None,
    seed_bpm: float | None = None,
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
            s.feature_vector <=> CAST(:vec AS vector) AS _dist,
            s.bpm, s.key_mode,
            s.mood_happy, s.mood_sad, s.mood_aggressive, s.mood_relaxed, s.mood_party,
            s.beat_strength, s.spectral_centroid, s.dyn_complexity
        FROM songs s
        LEFT JOIN artists a ON a.id = s.artist_id
        WHERE s.id::text != ALL(:excluded)
          AND s.analysed_at IS NOT NULL
          AND s.feature_vector IS NOT NULL
          AND s.is_staged = FALSE
    """
    params: dict[str, Any] = {"vec": vec_str, "excluded": excl_list}
    if seed_bpm is not None:
        params["seed_bpm"] = seed_bpm

    if profile_id:
        try:
            pid = _uuid.UUID(profile_id)
            base_q += " AND s.profile_id = :pid"
            params["pid"] = pid
        except ValueError:
            pass

    if seed_mode in ("major", "minor"):
        base_q += " AND (s.key_mode = :seed_mode OR s.key_mode IS NULL)"
        params["seed_mode"] = seed_mode

    if seed_mode is not None and "seed_bpm" in params:
        sbpm = params["seed_bpm"]
        base_q += (
            " AND (s.bpm IS NULL"
            " OR (s.bpm BETWEEN :bpm_min AND :bpm_max)"
            " OR (s.bpm BETWEEN :bpm_half_min AND :bpm_half_max)"
            " OR (s.bpm BETWEEN :bpm_dbl_min AND :bpm_dbl_max))"
        )
        params.update({
            "bpm_min": sbpm * 0.80, "bpm_max": sbpm * 1.20,
            "bpm_half_min": sbpm * 0.40, "bpm_half_max": sbpm * 0.60,
            "bpm_dbl_min": sbpm * 1.60, "bpm_dbl_max": sbpm * 2.40,
        })

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
    artist_name = row[7] or row[6] or ""
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
        "bpm": float(row[9]) if row[9] is not None else None,
        "key_mode": row[10],
        "mood_happy": float(row[11]) if row[11] is not None else None,
        "mood_sad": float(row[12]) if row[12] is not None else None,
        "mood_aggressive": float(row[13]) if row[13] is not None else None,
        "mood_relaxed": float(row[14]) if row[14] is not None else None,
        "mood_party": float(row[15]) if row[15] is not None else None,
        "beat_strength": float(row[16]) if row[16] is not None else None,
        "spectral_centroid": float(row[17]) if row[17] is not None else None,
        "dyn_complexity": float(row[18]) if row[18] is not None else None,
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


# ── On-demand analysis trigger ────────────────────────────────────────────────

async def _analyse_one(song_id: str) -> None:
    """Trigger immediate Essentia analysis for a single song (no vector yet)."""
    try:
        import uuid as _uuid
        from ..core.database import AsyncSessionLocal
        from ..services.essentia_svc import extract_features
        import httpx, tempfile
        from datetime import datetime, timezone
        from pathlib import Path

        pid = _uuid.UUID(song_id)
        async with AsyncSessionLocal() as db:
            song = await db.get(Song, pid)
            if not song or not song.navidrome_id or song.feature_vector is not None:
                return

            # Download to temp
            import os as _os
            nav_url = _os.environ.get("NAVIDROME_URL", "http://navidrome:4533")
            nav_user = _os.environ.get("NAVIDROME_USER", "admin")
            nav_pass = _os.environ.get("NAVIDROME_PASS", "musicapp123")
            params = {"u": nav_user, "p": nav_pass, "v": "1.8.0", "c": "musicapp",
                      "id": song.navidrome_id, "format": "raw"}
            async with httpx.AsyncClient(timeout=60) as client:
                r = await client.get(f"{nav_url}/rest/stream", params=params)
                if r.status_code != 200:
                    return
                ct = r.headers.get("content-type", "")
                ext = ".flac" if "flac" in ct else ".m4a" if "mp4" in ct else ".mp3"
                with tempfile.NamedTemporaryFile(suffix=ext, dir="/tmp", delete=False) as f:
                    f.write(r.content)
                    tmp = f.name

            try:
                features = await extract_features(tmp)
                if features:
                    # Apply ALL columns (bpm/key/mood/vibe), not just the vector —
                    # otherwise analysed_at gets set with those NULL and the
                    # scheduled full pass skips the song forever, leaving auto-
                    # radio scoring without BPM/key/vibe.
                    from ..services.essentia_svc import _apply_features_to_song
                    _apply_features_to_song(song, features)
                    song.analysed_at = datetime.now(timezone.utc)
                    await db.commit()
                    log.info("on-demand analysis done for %s", song_id)
                else:
                    # Leave analysed_at NULL so the scheduled job retries fully.
                    log.info("on-demand analysis: no features for %s, leaving unanalysed", song_id)
            finally:
                Path(tmp).unlink(missing_ok=True)
    except Exception as e:
        log.warning("_analyse_one failed for %s: %s", song_id, e)


