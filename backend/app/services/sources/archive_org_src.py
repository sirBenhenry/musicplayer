"""archive.org source adapter — free/legal live recordings and classical."""
import logging

import httpx

from ...core.config import get_settings

log = logging.getLogger(__name__)
NAME = "archive"
_BASE = "https://archive.org"


async def download(job) -> bool:
    query = f"creator:({job.artist}) AND title:({job.title}) AND mediatype:audio"
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(
            f"{_BASE}/advancedsearch.php",
            params={"q": query, "fl[]": "identifier", "rows": "5", "output": "json"},
        )
        r.raise_for_status()
        docs = r.json().get("response", {}).get("docs", [])

    if not docs:
        raise RuntimeError(f"no archive.org results for '{job.artist} - {job.title}'")

    identifier = docs[0]["identifier"]
    settings = get_settings()
    out_dir = settings.MUSIC_DIR

    # Get file list for the item
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{_BASE}/metadata/{identifier}/files")
        r.raise_for_status()
        files = r.json().get("result", [])

    audio_files = [f for f in files if f.get("name", "").lower().endswith((".flac", ".mp3", ".ogg"))]
    if not audio_files:
        raise RuntimeError(f"archive.org item {identifier} has no audio files")

    # Download first audio file
    fname = audio_files[0]["name"]
    url = f"{_BASE}/download/{identifier}/{fname}"

    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        r = await client.get(url)
        r.raise_for_status()
        dest = f"{out_dir}/{fname}"
        with open(dest, "wb") as fh:
            fh.write(r.content)

    log.info("archive.org: downloaded %s - %s from %s", job.artist, job.title, identifier)
    return True
