"""Subprocess worker for Essentia extraction. Called by extract_features().

Runs as: python -m app.services._essentia_worker <file_path>
Prints JSON feature vector to stdout on success; exits 1 on failure.
Isolation: if Essentia's C code calls exit(0/1) or segfaults, only this
subprocess dies — the parent uvicorn process is unaffected.
"""
import json
import sys


def _extract(file_path: str):
    import numpy as np
    import essentia.standard as es

    loader = es.MonoLoader(filename=file_path, sampleRate=44100)
    audio = loader()

    rhythm_extractor = es.RhythmExtractor2013(method="multifeature")
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


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: _essentia_worker.py <file_path>", file=sys.stderr)
        sys.exit(2)

    file_path = sys.argv[1]
    try:
        result = _extract(file_path)
        print(json.dumps(result))
        sys.exit(0)
    except Exception as e:
        print(f"Extraction failed: {e}", file=sys.stderr)
        sys.exit(1)
