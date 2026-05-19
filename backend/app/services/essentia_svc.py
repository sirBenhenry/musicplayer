"""Audio feature extraction using Essentia. Runs in a thread pool (CPU-bound)."""
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import numpy as np

log = logging.getLogger(__name__)
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="essentia")


def _extract_sync(file_path: str) -> Optional[list[float]]:
    """Synchronous Essentia feature extraction. Returns 128-dim float32 vector."""
    try:
        import essentia.standard as es

        loader = es.MonoLoader(filename=file_path, sampleRate=44100)
        audio = loader()

        # BPM
        rhythm_extractor = es.RhythmExtractor2013(method="multifeature")
        bpm, beats, beats_confidence, _, beats_intervals = rhythm_extractor(audio)

        # Key + scale (2 values: key index 0–11, major=1/minor=0)
        key_extractor = es.KeyExtractor()
        key, scale, key_strength = key_extractor(audio)
        key_idx = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"].index(key)
        scale_val = 1.0 if scale == "major" else 0.0

        # MFCC (13 coefficients × mean)
        windowing = es.Windowing(type="hann")
        spectrum = es.Spectrum()
        mfcc_extractor = es.MFCC(numberCoefficients=13)
        mfcc_frames = []
        frame_gen = es.FrameGenerator(audio, frameSize=2048, hopSize=512)
        for frame in frame_gen:
            spec = spectrum(windowing(frame))
            _, mfcc = mfcc_extractor(spec)
            mfcc_frames.append(mfcc)
        mfcc_mean = np.mean(mfcc_frames, axis=0) if mfcc_frames else np.zeros(13)

        # Spectral centroid mean + var
        sc_extractor = es.SpectralCentroidTime()
        sc_frames = []
        for frame in es.FrameGenerator(audio, frameSize=2048, hopSize=512):
            sc_frames.append(sc_extractor(frame))
        sc_arr = np.array(sc_frames) if sc_frames else np.zeros(1)
        sc_mean = float(np.mean(sc_arr))
        sc_var = float(np.var(sc_arr))

        # Energy + loudness
        energy = float(es.Energy()(audio))
        loudness = float(es.Loudness()(audio))

        # Danceability
        danceability_extractor = es.Danceability()
        danceability, _ = danceability_extractor(audio)

        # Build 128-dim vector: pad/truncate to exactly 128
        features = np.array([
            bpm / 200.0,       # normalise BPM
            key_idx / 11.0,
            scale_val,
            key_strength,
            *mfcc_mean,        # 13
            sc_mean / 10000.0,
            sc_var / 1e8,
            min(energy, 1.0),
            min(abs(loudness) / 100.0, 1.0),
            float(danceability),
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
    """Async wrapper — runs extraction in thread pool."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _extract_sync, file_path)


async def analyse_pending_songs() -> int:
    """Find songs with no feature_vector and analyse them."""
    from datetime import datetime, timezone
    from sqlalchemy import select
    from ..core.database import AsyncSessionLocal
    from ..models.library import Song

    analysed = 0
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Song).where(Song.analysed_at == None, Song.file_path != None).limit(50)  # noqa: E711
        )
        songs = result.scalars().all()

        for song in songs:
            vec = await extract_features(song.file_path)
            if vec:
                song.feature_vector = vec
                song.analysed_at = datetime.now(timezone.utc)
                await _auto_assign_profile(db, song, vec)
                analysed += 1

        await db.commit()

    return analysed


async def _auto_assign_profile(db, song, vec: list[float]) -> None:
    """Assign profile by cosine similarity to profile centroids. Flag uncertain cases."""
    from sqlalchemy import select, func
    from ..models.profile import Profile
    from ..models.library import Song as SongModel
    import numpy as np

    if song.profile_id:
        return  # already assigned

    result = await db.execute(select(Profile))
    profiles = result.scalars().all()
    if not profiles:
        return

    song_vec = np.array(vec, dtype=np.float32)
    scores: list[tuple[float, Profile]] = []

    for profile in profiles:
        # Compute centroid of all songs in this profile that have vectors
        centroid_res = await db.execute(
            select(SongModel.feature_vector).where(
                SongModel.profile_id == profile.id,
                SongModel.feature_vector != None,  # noqa: E711
            ).limit(500)
        )
        vecs = [row[0] for row in centroid_res if row[0]]
        if not vecs:
            scores.append((0.0, profile))
            continue
        centroid = np.mean([np.array(v, dtype=np.float32) for v in vecs], axis=0)
        cos_sim = float(np.dot(song_vec, centroid) / (np.linalg.norm(song_vec) * np.linalg.norm(centroid) + 1e-8))
        scores.append((cos_sim, profile))

    scores.sort(key=lambda x: x[0], reverse=True)

    if len(scores) == 1 or (scores[0][0] - scores[1][0]) > 0.15:
        song.profile_id = scores[0][1].id
        song.needs_profile_assignment = False
    else:
        song.needs_profile_assignment = True
