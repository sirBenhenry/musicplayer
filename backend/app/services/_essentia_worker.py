"""Subprocess worker for Essentia extraction. Called by extract_features().

Modes:
  essentia  (default) — full Essentia feature extraction
  numpy               — pure Python/numpy fallback; no Essentia C code; cannot SIGSEGV

Runs as: python -m app.services._essentia_worker <file_path> [mode]
Prints JSON feature vector to stdout on success; exits 1 on failure.
"""
import json
import os
import sys


def _load_wav_safe(wav_path: str):
    """Load mono 44100Hz WAV into float32 numpy array using Python's wave module.

    Never calls Essentia C code — cannot SIGSEGV. Returns ndarray or None.
    """
    import wave
    import numpy as np
    try:
        with wave.open(wav_path, 'rb') as wf:
            channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            n_frames = wf.getnframes()
            if n_frames == 0:
                return None
            raw = wf.readframes(n_frames)

        if sampwidth == 1:
            audio = np.frombuffer(raw, dtype=np.uint8).astype(np.float32) / 128.0 - 1.0
        elif sampwidth == 2:
            audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        elif sampwidth == 3:
            raw3 = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
            ints = (raw3[:, 0].astype(np.int32) |
                    (raw3[:, 1].astype(np.int32) << 8) |
                    (raw3[:, 2].astype(np.int32) << 16))
            audio = np.where(ints >= (1 << 23), ints - (1 << 24), ints).astype(np.float32) / (1 << 23)
        elif sampwidth == 4:
            audio = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
        else:
            return None

        if channels > 1:
            audio = audio.reshape(-1, channels).mean(axis=1)

        return audio.astype(np.float32)
    except Exception as e:
        print(f"wave load error: {e}", file=sys.stderr)
        return None


def _do_extract(file_path: str) -> list:
    """Full Essentia extraction. May SIGSEGV on malformed/unsupported audio."""
    import numpy as np
    import essentia.standard as es

    loader = es.MonoLoader(filename=file_path, sampleRate=44100)
    audio = loader()

    if len(audio) == 0:
        raise ValueError("Empty audio")

    # Pad to minimum 2 seconds so frame-level algorithms don't crash on short files
    MIN_SAMPLES = 44100 * 2
    if len(audio) < MIN_SAMPLES:
        audio = np.pad(audio, (0, MIN_SAMPLES - len(audio)))

    # degara is faster and more stable than multifeature on edge-case audio
    rhythm_extractor = es.RhythmExtractor2013(method="degara")
    bpm, beats, beats_confidence, _, beats_intervals = rhythm_extractor(audio)

    key_extractor = es.KeyExtractor()
    key, scale, key_strength = key_extractor(audio)
    _KEY_MAP = {
        "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3,
        "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8,
        "A": 9, "A#": 10, "Bb": 10, "B": 11,
    }
    key_idx = _KEY_MAP.get(key, 0)
    scale_val = 1.0 if scale == "major" else 0.0

    windowing = es.Windowing(type="hann")
    spectrum = es.Spectrum()
    mfcc_extractor = es.MFCC(numberCoefficients=13)
    hpcp_extractor = es.HPCP()
    sc_extractor = es.SpectralCentroidTime()
    rolloff_extractor = es.RollOff()
    zcr_extractor = es.ZeroCrossingRate()
    dissonance_extractor = es.Dissonance()
    spec_peaks = es.SpectralPeaks()

    mfcc_frames, hpcp_frames, sc_frames = [], [], []
    rolloff_frames, zcr_frames, dissonance_frames = [], [], []

    for frame in es.FrameGenerator(audio, frameSize=2048, hopSize=512):
        windowed = windowing(frame)
        spec = spectrum(windowed)
        _, mfcc = mfcc_extractor(spec)
        mfcc_frames.append(mfcc)
        freqs, mags = spec_peaks(spec)
        hpcp_frames.append(hpcp_extractor(freqs, mags))
        sc_frames.append(sc_extractor(frame))
        rolloff_frames.append(rolloff_extractor(spec))
        zcr_frames.append(float(zcr_extractor(frame)))
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

    energy = float(es.Energy()(audio))
    loudness = float(es.Loudness()(audio))
    danceability, _ = es.Danceability()(audio)
    dynamic_complexity, _ = es.DynamicComplexity()(audio)

    features = np.array([
        bpm / 200.0,
        key_idx / 11.0,
        scale_val,
        key_strength,
        *mfcc_mean,
        sc_mean / 10000.0,
        sc_var / 1e8,
        min(energy, 1.0),
        min(abs(loudness) / 100.0, 1.0),
        float(danceability),
        *hpcp_mean,
        rolloff_mean / 22050.0,
        zcr_mean,
        dissonance_mean,
        min(float(dynamic_complexity) / 10.0, 1.0),
    ], dtype=float)

    if len(features) < 128:
        features = list(features) + [0.0] * (128 - len(features))
    else:
        features = list(features[:128])

    return features


def _extract_numpy_only(file_path: str) -> list:
    """Pure numpy feature extraction using Python's wave module.

    No Essentia C code — cannot SIGSEGV. Produces a sparse but valid 128-dim vector.
    Positions match the full Essentia vector layout so similarity comparisons still work
    for the dimensions that are populated (energy, ZCR, spectral centroid, rolloff, MFCC).
    """
    import numpy as np

    audio = _load_wav_safe(file_path)
    if audio is None or len(audio) == 0:
        return [0.0] * 128

    # Normalize
    max_val = float(np.max(np.abs(audio)))
    if max_val > 1e-8:
        audio = audio / max_val

    frame_size = 2048
    hop_size = 512
    sr = 44100

    # Build simple mel filterbank for MFCC
    n_mfcc = 13
    n_fft = frame_size
    n_bins = n_fft // 2 + 1

    def hz_to_mel(hz):
        return 2595.0 * np.log10(1.0 + hz / 700.0)

    def mel_to_hz(mel):
        return 700.0 * (10.0 ** (mel / 2595.0) - 1.0)

    mel_pts = np.linspace(hz_to_mel(0), hz_to_mel(sr / 2), n_mfcc + 2)
    hz_pts = mel_to_hz(mel_pts)
    bin_pts = np.floor((n_fft + 1) * hz_pts / sr).astype(int).clip(0, n_bins - 1)

    filterbank = np.zeros((n_mfcc, n_bins))
    for m in range(1, n_mfcc + 1):
        lo, mid, hi = bin_pts[m - 1], bin_pts[m], bin_pts[m + 1]
        for k in range(lo, mid):
            filterbank[m - 1, k] = (k - lo) / max(mid - lo, 1)
        for k in range(mid, hi):
            filterbank[m - 1, k] = (hi - k) / max(hi - mid, 1)

    hann = np.hanning(frame_size)
    mfcc_frames, sc_frames, rolloff_frames, zcr_frames = [], [], [], []
    freqs = np.fft.rfftfreq(frame_size, d=1.0 / sr)

    n_samples = len(audio)
    for start in range(0, max(1, n_samples - frame_size + 1), hop_size):
        frame = audio[start: start + frame_size]
        if len(frame) < frame_size:
            frame = np.pad(frame, (0, frame_size - len(frame)))

        windowed = frame * hann
        spec = np.abs(np.fft.rfft(windowed))
        power = spec ** 2

        # Spectral centroid
        spec_sum = float(np.sum(spec))
        sc = float(np.dot(freqs, spec) / spec_sum) if spec_sum > 0 else 0.0
        sc_frames.append(sc)

        # Rolloff (85%)
        cumsum = np.cumsum(power)
        total = float(cumsum[-1])
        if total > 0:
            idx = int(np.searchsorted(cumsum, 0.85 * total))
            rolloff = float(freqs[min(idx, len(freqs) - 1)])
        else:
            rolloff = 0.0
        rolloff_frames.append(rolloff)

        # ZCR
        zcr_frames.append(float(np.mean(np.abs(np.diff(np.sign(frame)))) / 2.0))

        # Mel MFCC
        mel_e = filterbank @ power
        mel_e = np.where(mel_e > 0, mel_e, 1e-10)
        log_mel = np.log(mel_e)
        n = np.arange(n_mfcc)
        mfcc = np.sum(log_mel[:, None] * np.cos(np.pi * n[None, :] * (np.arange(n_mfcc)[:, None] + 0.5) / n_mfcc), axis=0)
        mfcc_frames.append(mfcc)

    if not sc_frames:
        return [0.0] * 128

    sc_arr = np.array(sc_frames)
    sc_mean = float(np.mean(sc_arr))
    sc_var = float(np.var(sc_arr))
    rolloff_mean = float(np.mean(rolloff_frames))
    zcr_mean = float(np.mean(zcr_frames))
    mfcc_mean = np.mean(mfcc_frames, axis=0) if mfcc_frames else np.zeros(n_mfcc)

    # Normalize MFCC to [-1, 1]
    mfcc_scale = float(np.max(np.abs(mfcc_mean)))
    if mfcc_scale > 0:
        mfcc_mean = (mfcc_mean / mfcc_scale).clip(-1.0, 1.0)

    # Song-level
    energy = float(min(np.sqrt(float(np.mean(audio ** 2))), 1.0))

    # Rough BPM via energy-flux autocorrelation
    bpm = 120.0
    if n_samples >= frame_size * 4:
        onset = []
        prev_e = 0.0
        for s in range(0, n_samples - frame_size, hop_size):
            e = float(np.mean(audio[s: s + frame_size] ** 2))
            onset.append(max(0.0, e - prev_e))
            prev_e = e
        if len(onset) > 20:
            arr = np.array(onset)
            lo = max(1, int(sr * 60 / (200 * hop_size)))
            hi = min(int(sr * 60 / (40 * hop_size)), len(arr) // 2)
            if hi > lo:
                ac = np.correlate(arr, arr, mode="full")[len(arr) - 1:]
                peak = int(np.argmax(ac[lo:hi])) + lo
                bpm = float(np.clip((sr * 60.0) / (peak * hop_size), 40.0, 200.0))

    features = [0.0] * 128
    features[0] = bpm / 200.0
    # [1] key, [2] scale, [3] key_strength — unknown, leave 0
    for i, v in enumerate(mfcc_mean[:13]):           # [4-16] MFCC
        features[4 + i] = float(v)
    features[17] = sc_mean / 10000.0                 # spectral centroid mean
    features[18] = sc_var / 1e8                      # spectral centroid var
    features[19] = energy                            # energy
    features[20] = energy                            # loudness ≈ RMS
    # [21] danceability, [22-33] HPCP — unknown, leave 0
    features[34] = rolloff_mean / 22050.0            # spectral rolloff
    features[35] = min(zcr_mean, 1.0)               # ZCR
    # [36] dissonance, [37] dynamic complexity — unknown, leave 0

    return features


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: _essentia_worker.py <file_path> [essentia|numpy]", file=sys.stderr)
        sys.exit(2)

    file_path = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "essentia"

    try:
        if mode == "numpy":
            result = _extract_numpy_only(file_path)
        else:
            result = _do_extract(file_path)
        print(json.dumps(result))
        sys.exit(0)
    except Exception as e:
        print(f"Extraction failed ({mode}): {e}", file=sys.stderr)
        sys.exit(1)
