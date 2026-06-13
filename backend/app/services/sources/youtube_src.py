"""yt-dlp source adapter — prefers YouTube Music, falls back to regular YouTube."""
import asyncio
import logging
import os
import shutil
import tempfile
from pathlib import Path

from ...core.config import get_settings
from .base import Candidate

log = logging.getLogger(__name__)
NAME = "youtube"

_SEARCH_RESULTS = 3  # check top-N results per search provider
_YT_DL_SEM: asyncio.Semaphore | None = None


def _yt_dl_sem() -> asyncio.Semaphore:
    global _YT_DL_SEM
    if _YT_DL_SEM is None:
        _YT_DL_SEM = asyncio.Semaphore(5)
    return _YT_DL_SEM


def _parse_format_from_ext(ext: str) -> tuple[str, int | None]:
    ext = (ext or "").lower().lstrip(".")
    if ext in ("flac",):
        return "FLAC", None
    if ext in ("m4a", "aac"):
        return "AAC", None
    if ext in ("opus",):
        return "OPUS", None
    if ext in ("ogg",):
        return "OGG", None
    return "MP3", None


async def search(job) -> list[Candidate]:
    try:
        import yt_dlp
    except ImportError:
        raise RuntimeError("yt-dlp not installed")

    query = f"{job.artist} - {getattr(job, 'search_title', job.title)}"
    candidates: list[Candidate] = []

    def _flat_search(url: str, label: str) -> list[dict]:
        opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": True,
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
                return info.get("entries", []) if info else []
        except Exception as e:
            log.warning("youtube: flat search failed (%s): %s", label, e)
            return []

    # ytsearch is the stable search prefix across all yt-dlp versions
    entries = await asyncio.to_thread(_flat_search, f"ytsearch{_SEARCH_RESULTS}:{query}", "ytsearch")
    source_label = "youtube"

    for entry in entries:
        video_id = entry.get("id") or entry.get("url") or ""
        title = entry.get("title") or job.title
        uploader = entry.get("uploader") or entry.get("channel") or job.artist
        ext = entry.get("ext") or "m4a"
        fmt, bitrate = _parse_format_from_ext(ext)

        candidates.append(Candidate(
            source=NAME,
            title=title,
            artist=uploader,
            album=None,
            format=fmt,
            bitrate=bitrate,
            file_size=None,
            has_cover_art=True,  # YouTube always has thumbnail
            metadata={"youtube_source": source_label},
            download_ref={"video_id": video_id, "search_prefix": source_label},
        ))

    log.info("youtube: %d candidates for %s - %s", len(candidates), job.artist, job.title)
    return candidates


_AUDIO_EXTS = {".mp3", ".m4a", ".aac", ".opus", ".ogg", ".flac", ".webm", ".wav"}


async def download(candidate: Candidate, dest_dir: str) -> tuple[bool, str | None]:
    try:
        import yt_dlp
    except ImportError:
        raise RuntimeError("yt-dlp not installed")

    ref = candidate.download_ref or {}
    video_id = ref.get("video_id", "")
    search_prefix = ref.get("search_prefix", "ytmsearch")

    if video_id and not video_id.startswith("http"):
        url = f"https://www.youtube.com/watch?v={video_id}"
    elif video_id.startswith("http"):
        url = video_id
    else:
        query = f"{candidate.artist} - {candidate.title}"
        url = f"{search_prefix}1:{query}"

    # Use a per-download temp dir so we can reliably find the output file
    # regardless of what extension FFmpegExtractAudio produces.
    tmp_dir = tempfile.mkdtemp(dir=dest_dir, prefix=".yt_")
    out_template = os.path.join(tmp_dir, "%(title)s.%(ext)s")

    # Embed the thumbnail as cover art (ffmpeg is in the image) so the +5
    # cover-art score and the post-download has_cover flag are truthful.
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": out_template,
        "writethumbnail": True,
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "best"},
            {"key": "EmbedThumbnail"},
        ],
        "quiet": True,
        "no_warnings": True,
    }

    def _run():
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            return info is not None

    try:
        async with _yt_dl_sem():
            ok = await asyncio.to_thread(_run)
    except Exception:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise

    if not ok:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise RuntimeError(f"yt-dlp returned no result for '{candidate.artist} - {candidate.title}'")

    # Find the converted audio file in tmp_dir
    audio_files = [
        fn for fn in os.listdir(tmp_dir)
        if Path(fn).suffix.lower() in _AUDIO_EXTS
    ]
    if not audio_files:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise RuntimeError(f"yt-dlp produced no audio file for '{candidate.artist} - {candidate.title}'")

    src = os.path.join(tmp_dir, audio_files[0])
    dst = os.path.join(dest_dir, audio_files[0])
    shutil.move(src, dst)
    shutil.rmtree(tmp_dir, ignore_errors=True)

    log.info("youtube: downloaded %s - %s → %s", candidate.artist, candidate.title, dst)
    return True, dst
