"""Confidence scoring for download candidates.

Pre-download score (max 80):  identity(40) + quality(25) + source(15)
Full score      (max 100):    + metadata(15) + cover_art(5)

Pre-download score used for candidate ranking.
Full score computed after download + tag read; drives review_status.
"""
from dataclasses import dataclass

from .sources.base import Candidate

import re as _re

try:
    from rapidfuzz import fuzz as _fuzz
    _ratio = _fuzz.ratio
    _partial = _fuzz.partial_ratio
except ImportError:
    import difflib
    def _ratio(a: str, b: str) -> float:
        return difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio() * 100
    def _partial(a: str, b: str) -> float:
        return _ratio(a, b)


def _strip_parens(s: str) -> str:
    """Strip trailing parenthetical version suffixes: 'Beat It (Remaster)' → 'Beat It'."""
    t = s
    while True:
        stripped = _re.sub(r'\s*\([^)]+\)\s*$', '', t).strip()
        if stripped == t or not stripped:
            break
        t = stripped
    return t


def _romanize(text: str) -> str:
    """Convert non-Latin text to ASCII approximation. pykakasi for Japanese, unidecode fallback."""
    try:
        import pykakasi
        kks = pykakasi.kakasi()
        return "".join(item["hepburn"] for item in kks.convert(text)).lower()
    except Exception:
        try:
            from unidecode import unidecode
            return unidecode(text).lower()
        except Exception:
            return text.lower()


def _best_title_ratio(a: str, b: str) -> float:
    """Best fuzzy match between two titles, also comparing stripped and romanized versions."""
    scores = [
        _ratio(a, b),
        _partial(a, b),
        _ratio(_strip_parens(a), _strip_parens(b)),
        _partial(a, _strip_parens(b)),
        _partial(_strip_parens(a), b),
    ]
    if not a.isascii() or not b.isascii():
        ra, rb = _romanize(a), _romanize(b)
        scores += [
            _ratio(ra, rb),
            _partial(ra, rb),
            _ratio(_strip_parens(ra), _strip_parens(rb)),
        ]
    return max(scores)

UNCERTAIN_THRESHOLD = 55.0
POOR_QUALITY_THRESHOLD = 10.0

# Post-download acceptance gates (applied to full ScoreBreakdown after tag read)
WRONG_SONG_THRESHOLD = 15.0   # identity sub-score; below this → reject as wrong song
BAD_METADATA_THRESHOLD = 4.0  # metadata sub-score; below this → reject as unusable

_QUALITY_MAP: dict[tuple, float] = {
    ("FLAC", None): 25,
    ("MP3", 320): 20,
    ("MP3", 256): 17,
    ("MP3", 192): 12,
    ("MP3", 128): 8,
    ("AAC", 256): 15,
    ("AAC", 192): 12,
    ("AAC", 128): 9,
    ("OPUS", 192): 14,
    ("OPUS", 128): 11,
    ("OGG", 192): 13,
    ("OGG", 128): 10,
}

_SOURCE_MAP: dict[str, float] = {
    "qobuz":    15,
    "prowlarr": 13,
    "soulseek": 13.5,
    "spotdl":   10,
    "archive":  6,
    "youtube":  5,
}


@dataclass
class ScoreBreakdown:
    identity:  float
    quality:   float
    source:    float
    metadata:  float
    cover_art: float

    @property
    def total(self) -> float:
        return self.identity + self.quality + self.source + self.metadata + self.cover_art

    def to_dict(self) -> dict:
        return {
            "identity": round(self.identity, 2),
            "quality":  round(self.quality, 2),
            "source":   round(self.source, 2),
            "metadata": round(self.metadata, 2),
            "cover_art": round(self.cover_art, 2),
            "total":    round(self.total, 2),
        }


def _quality_score(fmt: str, bitrate: int | None) -> float:
    fmt_up = (fmt or "UNKNOWN").upper()
    if fmt_up == "FLAC":
        return 25.0
    # exact match
    if (fmt_up, bitrate) in _QUALITY_MAP:
        return _QUALITY_MAP[(fmt_up, bitrate)]
    # closest bitrate below
    best = 0.0
    for (f, b), pts in _QUALITY_MAP.items():
        if f == fmt_up and b is not None and bitrate is not None:
            if b <= bitrate and pts > best:
                best = pts
    return best if best else 5.0  # unknown lossy = 5


def score_candidate(c: Candidate, mb_recording: dict | None) -> ScoreBreakdown:
    """Score a candidate against the MusicBrainz reference recording."""

    # ── Identity (0-40) ──────────────────────────────────────────────────────
    identity = 0.0
    if mb_recording:
        ref_title  = (mb_recording.get("title") or "").lower()
        ref_artist = (mb_recording.get("artist_name") or "").lower()
        cand_title  = (c.title or "").lower()
        cand_artist = (c.artist or "").lower()

        # Compare against canonical title + all MB aliases (romaji, translations, etc.)
        title_aliases = [a.lower() for a in (mb_recording.get("title_aliases") or [])]
        t_ratio = max(
            _best_title_ratio(cand_title, ref_title),
            *[_best_title_ratio(cand_title, alias) for alias in title_aliases],
        ) if title_aliases else _best_title_ratio(cand_title, ref_title)
        a_ratio = max(_ratio(cand_artist, ref_artist), _partial(cand_artist, ref_artist))

        identity += t_ratio / 100 * 20   # title: max 20 pts
        identity += a_ratio / 100 * 10   # artist: max 10 pts

        # ISRC match: +8
        ref_isrc  = mb_recording.get("isrc") or ""
        cand_isrc = (c.metadata or {}).get("isrc") or ""
        if ref_isrc and cand_isrc and ref_isrc.upper() == cand_isrc.upper():
            identity += 8

        # MB recording ID in file tags: +2
        cand_mbid = (c.metadata or {}).get("musicbrainz_recordingid") or ""
        ref_mbid  = mb_recording.get("recording_id") or ""
        if ref_mbid and cand_mbid and ref_mbid == cand_mbid:
            identity += 2

        identity = min(identity, 40.0)
    else:
        # No MB reference — score purely on string quality (max 20)
        identity = 20.0

    # ── Audio quality (0-25) ─────────────────────────────────────────────────
    quality = _quality_score(c.format, c.bitrate)

    # Soulseek FLAC files often don't advertise bitrate — give full score if FLAC
    if (c.format or "").upper() == "FLAC":
        quality = 25.0

    # ── Source tier (0-15) ───────────────────────────────────────────────────
    source = _SOURCE_MAP.get(c.source, 5.0)

    # Prowlarr FLAC > Prowlarr MP3
    if c.source == "prowlarr" and (c.format or "").upper() != "FLAC":
        source = 10.0

    # ── Metadata richness (0-15) ─────────────────────────────────────────────
    meta = c.metadata or {}
    meta_pts = 0.0
    for key in ("title", "artist", "album", "year", "track_num", "genre"):
        if meta.get(key):
            meta_pts += 2
    if meta.get("isrc"):
        meta_pts += 3
    metadata = min(meta_pts, 15.0)

    # ── Cover art (0-5) ──────────────────────────────────────────────────────
    cover_art = 5.0 if c.has_cover_art else 0.0

    return ScoreBreakdown(
        identity=round(identity, 2),
        quality=round(quality, 2),
        source=round(source, 2),
        metadata=round(metadata, 2),
        cover_art=round(cover_art, 2),
    )


def score_predownload(c: Candidate, mb_recording: dict | None) -> ScoreBreakdown:
    """Ranking score before download: identity + quality + source (max 80).

    Metadata and cover_art are zeroed — most sources can't provide them pre-download.
    Returns a ScoreBreakdown so callers can store the full breakdown for display.
    """
    # Identity (0-40)
    identity = 0.0
    if mb_recording:
        ref_title  = (mb_recording.get("title") or "").lower()
        ref_artist = (mb_recording.get("artist_name") or "").lower()
        cand_title  = (c.title or "").lower()
        cand_artist = (c.artist or "").lower()
        title_aliases = [a.lower() for a in (mb_recording.get("title_aliases") or [])]
        t_ratio = max(
            _best_title_ratio(cand_title, ref_title),
            *[_best_title_ratio(cand_title, alias) for alias in title_aliases],
        ) if title_aliases else _best_title_ratio(cand_title, ref_title)
        a_ratio = max(_ratio(cand_artist, ref_artist), _partial(cand_artist, ref_artist))
        identity += t_ratio / 100 * 20
        identity += a_ratio / 100 * 10
        ref_isrc  = mb_recording.get("isrc") or ""
        cand_isrc = (c.metadata or {}).get("isrc") or ""
        if ref_isrc and cand_isrc and ref_isrc.upper() == cand_isrc.upper():
            identity += 8
        cand_mbid = (c.metadata or {}).get("musicbrainz_recordingid") or ""
        ref_mbid  = mb_recording.get("recording_id") or ""
        if ref_mbid and cand_mbid and ref_mbid == cand_mbid:
            identity += 2
        identity = min(identity, 40.0)
    else:
        identity = 20.0

    # Quality (0-25)
    quality = _quality_score(c.format, c.bitrate)
    if (c.format or "").upper() == "FLAC":
        quality = 25.0

    # Source (0-15)
    source = _SOURCE_MAP.get(c.source, 5.0)
    if c.source == "prowlarr" and (c.format or "").upper() != "FLAC":
        source = 10.0

    return ScoreBreakdown(
        identity=round(identity, 2),
        quality=round(quality, 2),
        source=round(source, 2),
        metadata=0.0,
        cover_art=0.0,
    )


def is_acceptable(score: ScoreBreakdown) -> tuple[bool, str]:
    """Post-download quality gate. Returns (ok, rejection_reason)."""
    if score.identity < WRONG_SONG_THRESHOLD:
        return False, f"wrong_song (identity={score.identity:.1f}/40)"
    # Metadata gate removed — sparse tags are enriched from MusicBrainz after acceptance
    return True, ""


def review_status_for(score: ScoreBreakdown) -> str | None:
    """Return review_status string or None if no review needed."""
    if score.total < UNCERTAIN_THRESHOLD:
        return "pending_review"
    if score.quality < POOR_QUALITY_THRESHOLD:
        return "bad_quality"
    return None
