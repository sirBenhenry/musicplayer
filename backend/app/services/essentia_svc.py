"""Audio feature extraction using Essentia.

Each song is extracted in a subprocess (_essentia_worker.py) so that
C-level crashes or exit() calls in Essentia/FFmpeg cannot kill uvicorn.
"""
import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)


def _extract_sync(file_path: str) -> Optional[list[float]]:
    """Synchronous Essentia feature extraction. Returns 128-dim float32 vector.

    Vector layout (38 values used, rest zero-padded to 128):
      [0]     BPM / 200
      [1]     key index / 11  (0=C … 11=B)
      [2]     scale  (1=major, 0=minor)
      [3]     key strength
      [4-16]  MFCC mean (13 coefficients) — timbre texture
      [17]    spectral centroid mean / 10000
      [18]    spectral centroid var / 1e8
      [19]    energy
      [20]    loudness / 100
      [21]    danceability
      [22-33] HPCP mean (12 bins) — harmonic pitch class / chord color
      [34]    spectral rolloff / 22050  — brightness
      [35]    zero crossing rate mean   — percussiveness / noisiness
      [36]    dissonance                — harmonic tension
      [37]    dynamic complexity / 10  — loudness variation
      [38-127] zero padding
    """
    try:
        import essentia.standard as es

        loader = es.MonoLoader(filename=file_path, sampleRate=44100)
        audio = loader()

        # ── Rhythm ───────────────────────────────────────────────────────────
        rhythm_extractor = es.RhythmExtractor2013(method="multifeature")
        bpm, beats, beats_confidence, _, beats_intervals = rhythm_extractor(audio)

        # ── Key / Scale ───────────────────────────────────────────────────────
        key_extractor = es.KeyExtractor()
        key, scale, key_strength = key_extractor(audio)
        _KEY_MAP = {
            "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3,
            "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8,
            "A": 9, "A#": 10, "Bb": 10, "B": 11,
        }
        key_idx = _KEY_MAP.get(key, 0)
        scale_val = 1.0 if scale == "major" else 0.0

        # ── Frame-level features ──────────────────────────────────────────────
        windowing = es.Windowing(type="hann")
        spectrum = es.Spectrum()
        mfcc_extractor = es.MFCC(numberCoefficients=13)
        hpcp_extractor = es.HPCP()
        sc_extractor = es.SpectralCentroidTime()
        rolloff_extractor = es.RollOff()
        zcr_extractor = es.ZeroCrossingRate()
        dissonance_extractor = es.Dissonance()

        mfcc_frames = []
        hpcp_frames = []
        sc_frames = []
        rolloff_frames = []
        zcr_frames = []
        dissonance_frames = []

        spec_peaks = es.SpectralPeaks()

        for frame in es.FrameGenerator(audio, frameSize=2048, hopSize=512):
            windowed = windowing(frame)
            spec = spectrum(windowed)

            # MFCC
            _, mfcc = mfcc_extractor(spec)
            mfcc_frames.append(mfcc)

            # HPCP (harmonic pitch class profile)
            freqs, mags = spec_peaks(spec)
            hpcp = hpcp_extractor(freqs, mags)
            hpcp_frames.append(hpcp)

            # Spectral centroid
            sc_frames.append(sc_extractor(frame))

            # Spectral rolloff
            rolloff_frames.append(rolloff_extractor(spec))

            # Zero crossing rate
            zcr_frames.append(float(zcr_extractor(frame)))

            # Dissonance
            if len(freqs) > 1:
                dissonance_frames.append(float(dissonance_extractor(freqs, mags)))

        mfcc_mean = np.mean(mfcc_frames, axis=0) if mfcc_frames else np.zeros(13)
        hpcp_mean = np.mean(hpcp_frames, axis=0) if hpcp_frames else np.zeros(12)
        sc_arr = np.array(sc_frames) if sc_frames else np.zeros(1)
        sc_mean = float(np.mean(sc_arr))
        sc_var = float(np.var(sc_arr))
        rolloff_mean = float(np.mean(rolloff_frames)) if rolloff_frames else 0.0
        zcr_mean = float(np.mean(zcr_frames)) if zcr_frames else 0.0
        dissonance_mean = float(np.mean(dissonance_frames)) if dissonance_frames else 0.0

        # ── Song-level features ───────────────────────────────────────────────
        energy = float(es.Energy()(audio))
        loudness = float(es.Loudness()(audio))

        danceability_extractor = es.Danceability()
        danceability, _ = danceability_extractor(audio)

        dynamic_complexity_extractor = es.DynamicComplexity()
        dynamic_complexity, _ = dynamic_complexity_extractor(audio)

        # ── Assemble vector ───────────────────────────────────────────────────
        features = np.array([
            bpm / 200.0,
            key_idx / 11.0,
            scale_val,
            key_strength,
            *mfcc_mean,           # 13 values → indices 4–16
            sc_mean / 10000.0,
            sc_var / 1e8,
            min(energy, 1.0),
            min(abs(loudness) / 100.0, 1.0),
            float(danceability),
            *hpcp_mean,           # 12 values → indices 22–33
            rolloff_mean / 22050.0,
            zcr_mean,
            dissonance_mean,
            min(float(dynamic_complexity) / 10.0, 1.0),
        ], dtype=np.float32)

        # Pad to 128
        if len(features) < 128:
            features = np.pad(features, (0, 128 - len(features)))
        else:
            features = features[:128]

        return features.tolist()

    except Exception as e:
        log.error("Essentia extraction failed for %s: %s", file_path, e)
        return None


async def extract_features(file_path: str) -> Optional[list[float]]:
    """Run Essentia extraction in a subprocess for crash isolation.

    If Essentia's C code calls exit() or segfaults, only the subprocess dies.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "app.services._essentia_worker", file_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=180)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            log.error("Essentia timeout (180s) for %s", file_path)
            return None

        if proc.returncode != 0:
            msg = stderr.decode(errors="replace")[:300] if stderr else ""
            log.error("Essentia worker exit %d for %s: %s", proc.returncode, file_path, msg)
            return None

        try:
            return json.loads(stdout.decode())
        except (json.JSONDecodeError, ValueError):
            # Subprocess exited 0 but printed no valid JSON (e.g. C-level exit(0))
            msg = stderr.decode(errors="replace")[:200] if stderr else ""
            log.error("Essentia no output for %s: %s", file_path, msg)
            return None

    except Exception as e:
        log.error("extract_features error for %s: %s", file_path, e)
        return None


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
            tmp_path = await _download_to_temp(song.navidrome_id)
            try:
                if not tmp_path:
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
                await db.commit()  # commit per-song so crashes don't lose progress
            finally:
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

    # Fetch all pending song IDs + navidrome_ids
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Song.id, Song.navidrome_id)
            .where(Song.analysed_at == None)  # noqa: E711
        )
        pending = result.fetchall()  # list of (id, navidrome_id)

    if not pending:
        log.info("analyse_all_songs: nothing to do")
        return 0

    log.info("analyse_all_songs: %d songs to analyse", len(pending))
    sem = asyncio.Semaphore(6)
    total = 0
    COMMIT_BATCH = 50  # commit to DB every 50 songs extracted

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

    # Process in COMMIT_BATCH-sized chunks so we commit periodically
    for chunk_start in range(0, len(pending), COMMIT_BATCH):
        chunk = pending[chunk_start:chunk_start + COMMIT_BATCH]
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
    import os, tempfile, httpx

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
                with tempfile.NamedTemporaryFile(
                    suffix=ext, dir="/tmp", delete=False
                ) as f:
                    async for chunk in r.aiter_bytes(chunk_size=65536):
                        f.write(chunk)
                    return f.name
    except Exception as e:
        log.error("_download_to_temp %s: %s", navidrome_id, e)
        return None


def _resolve_path(file_path: str) -> Optional[str]:
    """Convert Song.file_path (absolute or relative) to absolute container path."""
    import os
    music_dir = os.environ.get("MUSIC_DIR", "/data/music/media/music")
    if not file_path:
        return None
    if file_path.startswith("/"):
        abs_path = file_path
    else:
        abs_path = f"{music_dir}/{file_path}"
    return abs_path if Path(abs_path).exists() else None


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
