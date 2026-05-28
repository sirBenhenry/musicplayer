"""Shared types for the parallel source search interface."""
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Candidate:
    source: str           # prowlarr|soulseek|youtube|archive|qobuz|spotdl
    title: str
    artist: str
    album: str | None
    format: str           # FLAC|MP3|AAC|OGG|OPUS|UNKNOWN
    bitrate: int | None   # kbps
    file_size: int | None # bytes
    has_cover_art: bool
    metadata: dict        # any extra tags: isrc, mbid, year, genre, track_num, etc.
    download_ref: Any     # source-specific handle passed back to download()
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "title": self.title,
            "artist": self.artist,
            "album": self.album,
            "format": self.format,
            "bitrate": self.bitrate,
            "file_size": self.file_size,
            "has_cover_art": self.has_cover_art,
            "metadata": self.metadata,
            "error": self.error,
        }
