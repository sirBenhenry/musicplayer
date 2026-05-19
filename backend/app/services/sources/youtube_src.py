"""yt-dlp source adapter — lossy fallback (256kbps AAC/Opus)."""
import asyncio
import logging
from pathlib import Path

from ...core.config import get_settings

log = logging.getLogger(__name__)
NAME = "youtube"


async def download(job) -> bool:
    """Download via yt-dlp. Returns True on success, raises on failure."""
    try:
        import yt_dlp
    except ImportError:
        raise RuntimeError("yt-dlp not installed")

    settings = get_settings()
    out_dir = settings.MUSIC_DIR

    query = f"ytsearch1:{job.artist} - {job.title} official audio"
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": f"{out_dir}/%(uploader)s/%(title)s.%(ext)s",
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "best"}],
        "quiet": True,
        "no_warnings": True,
        "default_search": "ytsearch",
    }

    def _run():
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(query, download=True)
            return info is not None

    ok = await asyncio.to_thread(_run)
    if not ok:
        raise RuntimeError(f"yt-dlp returned no result for '{job.artist} - {job.title}'")
    log.info("youtube: downloaded %s - %s", job.artist, job.title)
    return True
