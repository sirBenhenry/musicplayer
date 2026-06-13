"""archive.org source adapter — free/legal live recordings and classical."""
import logging
import os

import httpx

from ...core.config import get_settings
from .base import Candidate

log = logging.getLogger(__name__)
NAME = "archive"
_BASE = "https://archive.org"


def _parse_format(fname: str) -> tuple[str, int | None]:
    fn = fname.lower()
    if fn.endswith(".flac"):
        return "FLAC", None
    if fn.endswith(".mp3"):
        return "MP3", None
    if fn.endswith(".ogg"):
        return "OGG", None
    return "UNKNOWN", None


async def search(job) -> list[Candidate]:
    query = f"creator:({job.artist}) AND title:({getattr(job, 'search_title', job.title)}) AND mediatype:audio"
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(
            f"{_BASE}/advancedsearch.php",
            params={"q": query, "fl[]": "identifier", "rows": "5", "output": "json"},
        )
        r.raise_for_status()
        docs = r.json().get("response", {}).get("docs", [])

    if not docs:
        log.info("archive.org: no results for %s - %s", job.artist, job.title)
        return []

    candidates: list[Candidate] = []
    for doc in docs[:3]:
        identifier = doc["identifier"]
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.get(f"{_BASE}/metadata/{identifier}/files")
                r.raise_for_status()
                files = r.json().get("result", [])
        except Exception as e:
            log.warning("archive.org: metadata fetch failed for %s: %s", identifier, e)
            continue

        audio_files = [f for f in files if f.get("name", "").lower().endswith((".flac", ".mp3", ".ogg"))]
        if not audio_files:
            continue

        fname = audio_files[0]["name"]
        fmt, bitrate = _parse_format(fname)
        size = int(audio_files[0].get("size", 0) or 0)

        candidates.append(Candidate(
            source=NAME,
            title=job.title,
            artist=job.artist,
            album=None,
            format=fmt,
            bitrate=bitrate,
            file_size=size,
            has_cover_art=False,
            metadata={},
            download_ref={"identifier": identifier, "filename": fname},
        ))

    log.info("archive.org: %d candidates for %s - %s", len(candidates), job.artist, job.title)
    return candidates


async def download(candidate: Candidate, dest_dir: str) -> tuple[bool, str | None]:
    ref = candidate.download_ref or {}
    identifier = ref.get("identifier", "")
    fname = ref.get("filename", "")

    if not identifier or not fname:
        raise RuntimeError("archive.org candidate missing identifier/filename")

    url = f"{_BASE}/download/{identifier}/{fname}"
    dest = os.path.join(dest_dir, fname)
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        # Stream to disk — don't buffer the whole audio file in RAM.
        async with client.stream("GET", url) as r:
            r.raise_for_status()
            with open(dest, "wb") as fh:
                async for chunk in r.aiter_bytes(65536):
                    fh.write(chunk)

    log.info("archive.org: downloaded %s - %s from %s", candidate.artist, candidate.title, identifier)
    return True, dest
