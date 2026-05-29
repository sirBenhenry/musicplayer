"""Audio feature extraction using Essentia.

Three-level extraction pipeline — guarantees a vector for every downloadable song:

  Level 1  Essentia full extraction on original file (subprocess).
           May SIGSEGV on unsupported codecs or malformed audio — subprocess
           dies, parent catches exit code and falls through.

  Level 2  ffmpeg converts file to mono 44100Hz 16-bit PCM WAV, then Essentia
           full extraction on the WAV (new subprocess).
           Handles the common "AudioLoader: Unsupported codec!" case.
           Can still SIGSEGV on audio content that triggers Essentia C bugs.

  Level 3  Pure Python/numpy extraction on the WAV (_essentia_worker numpy mode).
           No Essentia C code — cannot SIGSEGV under any circumstances.
           Produces a sparse but valid 128-dim vector (energy, ZCR, spectral
           centroid, rolloff, MFCC populated; key/HPCP/danceability zeroed).

Only returns None when the file cannot be downloaded at all.
"""
import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

# In-memory set of song IDs currently being analysed (UUIDs as str).
# Cleared on restart — purely for live monitoring.
_currently_analysing: set[str] = set()


def get_currently_analysing() -> list[str]:
    return list(_currently_analysing)


async def _convert_to_wav_async(file_path: str) -> Optional[str]:
    """Convert audio to mono 44100Hz 16-bit PCM WAV via ffmpeg. Returns temp path or None."""
    import tempfile
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", dir="/tmp", delete=False)
    tmp.close()
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-i", file_path,
            "-ar", "44100", "-ac", "1", "-acodec", "pcm_s16le", "-f", "wav",
            tmp.name,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            log.error("ffmpeg WAV conversion timeout for %s", file_path)
            Path(tmp.name).unlink(missing_ok=True)
            return None

        if proc.returncode != 0:
            err = stderr.decode(errors="replace")[-300:] if stderr else ""
            log.warning("ffmpeg conversion failed for %s: %s", file_path, err)
            Path(tmp.name).unlink(missing_ok=True)
            return None

        # Reject empty/header-only files (valid WAV minimum is ~44 bytes header + data)
        size = Path(tmp.name).stat().st_size
        if size < 100:
            log.warning("ffmpeg produced near-empty WAV (%d bytes) for %s", size, file_path)
            Path(tmp.name).unlink(missing_ok=True)
            return None

        return tmp.name
    except Exception as e:
        log.error("ffmpeg error for %s: %s", file_path, e)
        Path(tmp.name).unlink(missing_ok=True)
        return None


async def _run_worker(file_path: str, mode: str = "essentia") -> Optional[list]:
    """Spawn essentia worker subprocess. Returns feature list or None on any failure."""
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "app.services._essentia_worker", file_path, mode,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=180)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            log.error("Worker timeout (mode=%s, 180s) for %s", mode, file_path)
            return None

        if proc.returncode != 0:
            msg = stderr.decode(errors="replace")[:300] if stderr else ""
            log.warning("Worker exit %d (mode=%s) for %s: %s",
                        proc.returncode, mode, file_path, msg)
            return None

        try:
            return json.loads(stdout.decode())
        except (json.JSONDecodeError, ValueError):
            msg = stderr.decode(errors="replace")[:200] if stderr else ""
            log.warning("Worker produced no valid JSON (mode=%s) for %s: %s",
                        mode, file_path, msg)
            return None

    except Exception as e:
        log.error("_run_worker error (mode=%s) for %s: %s", mode, file_path, e)
        return None


async def extract_features(file_path: str) -> Optional[list[float]]:
    """Extract 128-dim feature vector. Three-level fallback guarantees a result.

    Returns None only if the source file cannot be processed at all (extremely rare).
    """
    # ── Level 1: full Essentia on original ───────────────────────────────────
    result = await _run_worker(file_path, mode="essentia")
    if result is not None:
        return result

    log.info("Level 1 failed for %s — converting to WAV", file_path)

    # ── WAV conversion (shared by levels 2 & 3) ───────────────────────────
    wav_path = await _convert_to_wav_async(file_path)
    if wav_path is None:
        # ffmpeg couldn't produce a WAV — file is likely corrupt or empty
        log.error("WAV conversion failed for %s — no vector produced", file_path)
        return None

    try:
        # ── Level 2: full Essentia on WAV ────────────────────────────────────
        result = await _run_worker(wav_path, mode="essentia")
        if result is not None:
            log.info("Level 2 (Essentia/WAV) success for %s", file_path)
            return result

        log.info("Level 2 failed for %s — using numpy fallback", file_path)

        # ── Level 3: pure numpy on WAV (guaranteed, no Essentia C code) ──────
        result = await _run_worker(wav_path, mode="numpy")
        if result is not None:
            log.info("Level 3 (numpy/WAV) success for %s", file_path)
            return result

        log.error("All 3 levels failed for %s — this should not happen", file_path)
        return None

    finally:
        try:
            Path(wav_path).unlink()
        except Exception:
            pass


async def analyse_pending_songs(limit: int = 50) -> int:
    """Find songs with no feature_vector and analyse them. Returns count analysed."""
    from datetime import datetime, timezone
    from sqlalchemy import select
    from ..core.database import AsyncSessionLocal
    from ..models.library import Song

    analysed = 0
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Song).where(Song.analysed_at == None)  # noqa: E711
            .limit(limit)
        )
        songs = result.scalars().all()

        for song in songs:
            if not song.navidrome_id:
                continue
            _currently_analysing.add(str(song.id))
            tmp_path = await _download_to_temp(song.navidrome_id)
            try:
                if not tmp_path:
                    _currently_analysing.discard(str(song.id))
                    continue
                vec = await extract_features(tmp_path)
                song.analysed_at = datetime.now(timezone.utc)  # always mark; prevents infinite retry
                if vec:
                    song.feature_vector = vec
                    try:
                        await _auto_assign_profile(db, song, vec)
                    except Exception as ae:
                        log.warning("_auto_assign_profile failed for %s: %s", song.id, ae)
                    analysed += 1
                await db.commit()  # per-song commit so crashes don't lose progress
            finally:
                _currently_analysing.discard(str(song.id))
                if tmp_path and Path(tmp_path).exists():
                    try:
                        Path(tmp_path).unlink()
                    except Exception:
                        pass

    return analysed


async def analyse_all_songs() -> int:
    """Analyse every song lacking a vector. 6 concurrent, commits every 50 songs."""
    from datetime import datetime, timezone
    from sqlalchemy import select
    from ..core.database import AsyncSessionLocal
    from ..models.library import Song

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Song.id, Song.navidrome_id)
            .where(Song.analysed_at == None)  # noqa: E711
        )
        pending = result.fetchall()

    if not pending:
        log.info("analyse_all_songs: nothing to do")
        return 0

    log.info("analyse_all_songs: %d songs to analyse", len(pending))
    sem = asyncio.Semaphore(6)
    total = 0
    COMMIT_BATCH = 50

    async def _process_one(song_id, navidrome_id) -> tuple:
        async with sem:
            if not navidrome_id:
                return song_id, None
            tmp_path = await _download_to_temp(navidrome_id)
            try:
                if not tmp_path:
                    return song_id, None
                vec = await extract_features(tmp_path)
                return song_id, vec
            finally:
                if tmp_path and Path(tmp_path).exists():
                    try:
                        Path(tmp_path).unlink()
                    except Exception:
                        pass

    for chunk_start in range(0, len(pending), COMMIT_BATCH):
        chunk = pending[chunk_start: chunk_start + COMMIT_BATCH]
        results = await asyncio.gather(*[_process_one(sid, nid) for sid, nid in chunk])

        now = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as db:
            for song_id, vec in results:
                song = await db.get(Song, song_id)
                if not song:
                    continue
                song.analysed_at = now
                if vec:
                    song.feature_vector = vec
                    try:
                        await _auto_assign_profile(db, song, vec)
                    except Exception as ae:
                        log.warning("_auto_assign_profile failed for %s: %s", song_id, ae)
                    total += 1
            await db.commit()

        log.info("analyse_all_songs: %d/%d done, %d with vectors",
                 chunk_start + len(chunk), len(pending), total)

    log.info("analyse_all_songs: complete, %d/%d songs analysed", total, len(pending))
    return total


async def _download_to_temp(navidrome_id: str) -> Optional[str]:
    """Stream audio from Navidrome to a temp file. Returns temp path or None on error."""
    import os
    import tempfile
    import httpx

    nav_url = os.environ.get("NAVIDROME_URL", "http://navidrome:4533")
    nav_user = os.environ.get("NAVIDROME_USER", "admin")
    nav_pass = os.environ.get("NAVIDROME_PASS", "musicapp123")

    params = {
        "u": nav_user, "p": nav_pass,
        "v": "1.8.0", "c": "musicapp",
        "id": navidrome_id, "format": "raw",
    }
    url = f"{nav_url}/rest/stream"

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream("GET", url, params=params) as r:
                if r.status_code != 200:
                    log.warning("Navidrome stream %s: HTTP %d", navidrome_id, r.status_code)
                    return None
                content_type = r.headers.get("content-type", "")
                ext = ".flac" if "flac" in content_type else ".m4a" if "mp4" in content_type else ".mp3"
                with tempfile.NamedTemporaryFile(suffix=ext, dir="/tmp", delete=False) as f:
                    async for chunk in r.aiter_bytes(chunk_size=65536):
                        f.write(chunk)
                    return f.name
    except Exception as e:
        log.error("_download_to_temp %s: %s", navidrome_id, e)
        return None


async def _auto_assign_profile(db, song, vec: list[float]) -> None:
    """Assign profile by cosine similarity to profile centroids. Flag uncertain cases."""
    from sqlalchemy import select
    from ..models.profile import Profile
    from ..models.library import Song as SongModel
    import numpy as np

    if song.profile_id:
        return

    result = await db.execute(select(Profile))
    profiles = result.scalars().all()
    if not profiles:
        return

    song_vec = np.array(vec, dtype=np.float32)
    scores: list[tuple[float, Profile]] = []

    for profile in profiles:
        centroid_res = await db.execute(
            select(SongModel.feature_vector).where(
                SongModel.profile_id == profile.id,
                SongModel.feature_vector != None,  # noqa: E711
            ).limit(500)
        )
        vecs = [row[0] for row in centroid_res if row[0] is not None]
        if not vecs:
            scores.append((0.0, profile))
            continue
        centroid = np.mean([np.array(v, dtype=np.float32) for v in vecs], axis=0)
        norm_s = np.linalg.norm(song_vec)
        norm_c = np.linalg.norm(centroid)
        if norm_s < 1e-8 or norm_c < 1e-8:
            scores.append((0.0, profile))
            continue
        cos_sim = float(np.dot(song_vec, centroid) / (norm_s * norm_c))
        scores.append((cos_sim, profile))

    scores.sort(key=lambda x: x[0], reverse=True)

    if len(scores) == 1 or (scores[0][0] - scores[1][0]) > 0.15:
        song.profile_id = scores[0][1].id
        song.needs_profile_assignment = False
    else:
        song.needs_profile_assignment = True
