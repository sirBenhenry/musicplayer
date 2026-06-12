"""Audio feature extraction: EffnetDiscogs embedding + mood heads + BPM/key.

Primary embedding: EffnetDiscogs ONNX (1280-dim L2-normalised, cosine similarity).
Mood heads: 5 Essentia classification heads that run on the 1280-dim embedding
  (mood_happy, mood_sad, mood_aggressive, mood_relaxed, mood_party).
  No extra audio loading — reuse the already-computed embedding.
Classic features: BPM and key/mode via librosa (extracted from same audio load).
"""
import asyncio
import logging
import threading
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

_MODEL_DIR = "/app/models"
_EFFNET_PATH = f"{_MODEL_DIR}/discogs_multi_embeddings.onnx"
_MOOD_NAMES = ["happy", "sad", "aggressive", "relaxed", "party"]
_MOOD_PATHS = {
    name: f"{_MODEL_DIR}/mood_{name}-discogs-effnet-1.onnx"
    for name in _MOOD_NAMES
}

_BATCH_SIZE = 64
_PATCH_FRAMES = 96
_N_MELS = 128
_SR = 16000

_onnx_session = None
_mood_sessions: dict = {}
_onnx_lock = threading.Lock()

_currently_analysing: set[str] = set()

# Krumhansl-Schmuckler key profiles (pitch class correlation)
_KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
_KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]


def get_currently_analysing() -> list[str]:
    return list(_currently_analysing)


def _get_onnx_session():
    global _onnx_session
    if _onnx_session is None:
        with _onnx_lock:
            if _onnx_session is None:
                import onnxruntime as ort
                log.info("Loading EffnetDiscogs ONNX from %s", _EFFNET_PATH)
                opts = ort.SessionOptions()
                opts.intra_op_num_threads = 2
                opts.inter_op_num_threads = 2
                _onnx_session = ort.InferenceSession(_EFFNET_PATH, sess_options=opts)
                inp = _onnx_session.get_inputs()[0]
                log.info("ONNX model ready — input: %s %s", inp.name, inp.shape)
    return _onnx_session


def _get_mood_sessions() -> dict:
    global _mood_sessions
    if not _mood_sessions:
        with _onnx_lock:
            if not _mood_sessions:
                import onnxruntime as ort
                opts = ort.SessionOptions()
                opts.intra_op_num_threads = 1
                opts.inter_op_num_threads = 1
                for name, path in _MOOD_PATHS.items():
                    if Path(path).exists():
                        _mood_sessions[name] = ort.InferenceSession(path, sess_options=opts)
                        log.info("Mood head loaded: %s", name)
                    else:
                        log.warning("Mood model missing: %s", path)
    return _mood_sessions


def _run_mood_heads(embedding: "np.ndarray") -> dict:
    """Run all mood classification heads on a 1280-dim L2-normalised embedding."""
    import numpy as np
    sessions = _get_mood_sessions()
    results = {}
    vec = embedding.astype(np.float32).reshape(1, -1)
    for name, sess in sessions.items():
        inp_name = sess.get_inputs()[0].name
        out = sess.run(None, {inp_name: vec})[0]  # [1, 2] — [not_X, X]
        prob = float(out[0, 1]) if out.shape[-1] == 2 else float(out[0, 0])
        results[name] = round(prob, 4)
    return results


def _detect_key_mode(audio: "np.ndarray") -> tuple[int, str]:
    """Krumhansl-Schmuckler key finding. Returns (key_root 0-11, 'major'|'minor')."""
    import numpy as np
    import librosa

    chroma = librosa.feature.chroma_cqt(y=audio, sr=_SR, bins_per_octave=36)
    chroma_mean = chroma.mean(axis=1)

    major_p = np.array(_KS_MAJOR)
    minor_p = np.array(_KS_MINOR)

    best_score = -float("inf")
    best_key = 0
    best_mode = "major"

    for k in range(12):
        for profile, mode in [(major_p, "major"), (minor_p, "minor")]:
            rotated = np.roll(profile, k)
            corr = float(np.corrcoef(chroma_mean, rotated)[0, 1])
            if corr > best_score:
                best_score = corr
                best_key = k
                best_mode = mode

    return best_key, best_mode


def _extract_features_sync(file_path: str) -> Optional[dict]:
    """Synchronous full feature extraction. Run via run_in_executor."""
    try:
        import librosa
        import numpy as np
    except ImportError as e:
        log.error("Missing dependency: %s", e)
        return None

    try:
        audio, _ = librosa.load(file_path, sr=_SR, mono=True)
        if len(audio) == 0:
            return None

        # ── Mel spectrogram (EffnetDiscogs preprocessing) ─────────────────────
        mel = librosa.feature.melspectrogram(
            y=audio, sr=_SR, n_fft=512, hop_length=256,
            n_mels=_N_MELS, fmax=8000, norm="slaney", power=1.0,
        )
        mel = np.log(mel + 1e-9).astype(np.float32)

        n_frames = mel.shape[1]
        patches = []
        if n_frames < _PATCH_FRAMES:
            padded = np.pad(mel, ((0, 0), (0, _PATCH_FRAMES - n_frames)))
            patches.append(padded[:, :_PATCH_FRAMES])
        else:
            for i in range(0, n_frames - _PATCH_FRAMES + 1, _PATCH_FRAMES):
                patches.append(mel[:, i:i + _PATCH_FRAMES])

        if not patches:
            return None

        patches_arr = np.array(patches, dtype=np.float32)
        session = _get_onnx_session()
        input_name = session.get_inputs()[0].name

        all_embeddings = []
        for i in range(0, len(patches_arr), _BATCH_SIZE):
            batch = patches_arr[i:i + _BATCH_SIZE]
            actual = batch.shape[0]
            if actual < _BATCH_SIZE:
                pad = np.zeros((_BATCH_SIZE - actual, _N_MELS, _PATCH_FRAMES), dtype=np.float32)
                batch = np.concatenate([batch, pad], axis=0)
            out = session.run(None, {input_name: batch})[0]
            all_embeddings.append(out[:actual])

        embeddings = np.concatenate(all_embeddings, axis=0)
        mean_emb = embeddings.mean(axis=0)

        norm = float(np.linalg.norm(mean_emb))
        if norm > 1e-8:
            mean_emb = mean_emb / norm

        # ── Mood heads (run on embedding — no extra audio cost) ────────────────
        moods = _run_mood_heads(mean_emb)

        # ── BPM ───────────────────────────────────────────────────────────────
        try:
            tempo, _ = librosa.beat.beat_track(y=audio, sr=_SR)
            t = float(np.squeeze(tempo))
            bpm = t if np.isfinite(t) and t > 0 else None
        except Exception:
            bpm = None

        # ── Key + mode ────────────────────────────────────────────────────────
        try:
            key_root, key_mode = _detect_key_mode(audio)
        except Exception:
            key_root, key_mode = None, None

        # ── Beat strength (groove / danceability proxy) ───────────────────────
        try:
            onset_env = librosa.onset.onset_strength(y=audio, sr=_SR)
            beat_strength = float(min(1.0, float(onset_env.mean()) / 3.0))
        except Exception:
            beat_strength = None

        # ── Spectral centroid (brightness) ─────────────────────────────────────
        try:
            centroid = librosa.feature.spectral_centroid(y=audio, sr=_SR)
            spectral_centroid = float(min(1.0, float(centroid.mean()) / 8000.0))
        except Exception:
            spectral_centroid = None

        # ── Dynamic complexity (RMS energy std — consistency vs. dramatic arc) ─
        try:
            rms = librosa.feature.rms(y=audio)
            dyn_complexity = float(min(1.0, float(rms.std()) * 20.0))
        except Exception:
            dyn_complexity = None

        return {
            "vector": mean_emb.tolist(),
            "bpm": bpm,
            "key_root": key_root,
            "key_mode": key_mode,
            "beat_strength": beat_strength,
            "spectral_centroid": spectral_centroid,
            "dyn_complexity": dyn_complexity,
            **{f"mood_{k}": v for k, v in moods.items()},
        }

    except Exception as e:
        log.warning("Feature extraction failed for %s: %s", file_path, e)
        return None


def extract_mood_from_stored_vector(vec: list[float]) -> dict:
    """Run mood heads on an already-computed 1280-dim embedding (no audio needed).

    Used to backfill mood scores on songs that already have feature_vector.
    """
    import numpy as np
    emb = np.array(vec, dtype=np.float32)
    return _run_mood_heads(emb)


async def extract_features(file_path: str) -> Optional[dict]:
    """Extract all features: embedding + mood + BPM + key.

    Level 1: ONNX on original file.
    Level 2: ffmpeg WAV conversion then ONNX.
    Returns None if both fail.
    """
    loop = asyncio.get_event_loop()

    result = await loop.run_in_executor(None, _extract_features_sync, file_path)
    if result is not None:
        return result

    log.info("Level 1 failed for %s — converting to WAV", file_path)

    wav_path = await _convert_to_wav_async(file_path)
    if wav_path is None:
        log.error("WAV conversion failed for %s", file_path)
        return None

    try:
        result = await loop.run_in_executor(None, _extract_features_sync, wav_path)
        if result is not None:
            log.info("Level 2 (ONNX/WAV) success for %s", file_path)
            return result
        log.error("Both ONNX levels failed for %s", file_path)
        return None
    finally:
        Path(wav_path).unlink(missing_ok=True)


async def _convert_to_wav_async(file_path: str) -> Optional[str]:
    import tempfile
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", dir="/tmp", delete=False)
    tmp.close()
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-i", file_path,
            "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le", "-f", "wav",
            tmp.name,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            log.error("ffmpeg timeout for %s", file_path)
            Path(tmp.name).unlink(missing_ok=True)
            return None

        if proc.returncode != 0:
            err = stderr.decode(errors="replace")[-300:] if stderr else ""
            log.warning("ffmpeg failed for %s: %s", file_path, err)
            Path(tmp.name).unlink(missing_ok=True)
            return None

        if Path(tmp.name).stat().st_size < 100:
            Path(tmp.name).unlink(missing_ok=True)
            return None

        return tmp.name
    except Exception as e:
        log.error("ffmpeg error for %s: %s", file_path, e)
        Path(tmp.name).unlink(missing_ok=True)
        return None


def _apply_features_to_song(song, features: dict) -> None:
    song.feature_vector = features.get("vector")
    song.bpm = features.get("bpm")
    song.key_root = features.get("key_root")
    song.key_mode = features.get("key_mode")
    song.mood_happy = features.get("mood_happy")
    song.mood_sad = features.get("mood_sad")
    song.mood_aggressive = features.get("mood_aggressive")
    song.mood_relaxed = features.get("mood_relaxed")
    song.mood_party = features.get("mood_party")
    song.beat_strength = features.get("beat_strength")
    song.spectral_centroid = features.get("spectral_centroid")
    song.dyn_complexity = features.get("dyn_complexity")


async def analyse_pending_songs(limit: int = 50) -> int:
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
                features = await extract_features(tmp_path)
                song.analysed_at = datetime.now(timezone.utc)
                if features:
                    _apply_features_to_song(song, features)
                    try:
                        await _auto_assign_profile(db, song, features["vector"])
                    except Exception as ae:
                        log.warning("_auto_assign_profile failed for %s: %s", song.id, ae)
                    analysed += 1
                await db.commit()
            finally:
                _currently_analysing.discard(str(song.id))
                if tmp_path and Path(tmp_path).exists():
                    Path(tmp_path).unlink(missing_ok=True)

    return analysed


async def analyse_all_songs() -> int:
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
                features = await extract_features(tmp_path)
                return song_id, features
            finally:
                if tmp_path and Path(tmp_path).exists():
                    Path(tmp_path).unlink(missing_ok=True)

    for chunk_start in range(0, len(pending), COMMIT_BATCH):
        chunk = pending[chunk_start: chunk_start + COMMIT_BATCH]
        results = await asyncio.gather(*[_process_one(sid, nid) for sid, nid in chunk])

        now = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as db:
            for song_id, features in results:
                song = await db.get(Song, song_id)
                if not song:
                    continue
                song.analysed_at = now
                if features:
                    _apply_features_to_song(song, features)
                    try:
                        await _auto_assign_profile(db, song, features["vector"])
                    except Exception as ae:
                        log.warning("_auto_assign_profile failed for %s: %s", song_id, ae)
                    total += 1
            await db.commit()

        log.info("analyse_all_songs: %d/%d done, %d with vectors",
                 chunk_start + len(chunk), len(pending), total)

    log.info("analyse_all_songs: complete, %d/%d songs analysed", total, len(pending))
    return total


async def _download_to_temp(navidrome_id: str) -> Optional[str]:
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

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream("GET", f"{nav_url}/rest/stream", params=params) as r:
                if r.status_code != 200:
                    log.warning("Navidrome stream %s: HTTP %d", navidrome_id, r.status_code)
                    return None
                ct = r.headers.get("content-type", "")
                ext = ".flac" if "flac" in ct else ".m4a" if "mp4" in ct else ".mp3"
                with tempfile.NamedTemporaryFile(suffix=ext, dir="/tmp", delete=False) as f:
                    async for chunk in r.aiter_bytes(chunk_size=65536):
                        f.write(chunk)
                    return f.name
    except Exception as e:
        log.error("_download_to_temp %s: %s", navidrome_id, e)
        return None


async def _auto_assign_profile(db, song, vec: list[float]) -> None:
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
            ).limit(200)
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

    if len(scores) == 1 or (scores[0][0] - scores[1][0]) > 0.05:
        song.profile_id = scores[0][1].id
        song.needs_profile_assignment = False
    else:
        song.needs_profile_assignment = True


async def _analyse_one(song_id: str) -> None:
    from datetime import datetime, timezone
    from ..core.database import AsyncSessionLocal
    from ..models.library import Song

    async with AsyncSessionLocal() as db:
        song = await db.get(Song, song_id)
        if not song or not song.navidrome_id:
            return
        tmp_path = await _download_to_temp(song.navidrome_id)
        if not tmp_path:
            return
        try:
            features = await extract_features(tmp_path)
            if features:
                _apply_features_to_song(song, features)
                song.analysed_at = datetime.now(timezone.utc)
                await db.commit()
        finally:
            if tmp_path and Path(tmp_path).exists():
                Path(tmp_path).unlink(missing_ok=True)
