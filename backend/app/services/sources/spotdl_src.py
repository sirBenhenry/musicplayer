"""spotDL source adapter — YouTube Music with Spotify metadata (ISRC, cover art, full tags)."""
import asyncio
import json
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from ...core.config import get_settings
from .base import Candidate

log = logging.getLogger(__name__)
NAME = "spotdl"

# Limit concurrent spotdl download processes to avoid YouTube Music rate-limiting
_SPOTDL_DL_SEM = asyncio.Semaphore(3)


async def search(job) -> list[Candidate]:
    """Use spotdl save to find and validate the Spotify match (no download yet)."""
    query = f"{job.artist} - {getattr(job, 'search_title', job.title)}"

    with tempfile.NamedTemporaryFile(suffix=".spotdl", delete=False) as tf:
        save_path = tf.name

    def _run():
        result = subprocess.run(
            ["spotdl", "save", query, "--save-file", save_path, "--output", "/tmp"],
            capture_output=True, text=True, timeout=60,
        )
        return result.returncode, result.stdout, result.stderr

    try:
        code, stdout, stderr = await asyncio.to_thread(_run)
    except FileNotFoundError:
        raise RuntimeError("spotdl not installed (FileNotFoundError)")
    except subprocess.TimeoutExpired:
        raise RuntimeError("spotdl save timed out")
    finally:
        pass  # keep save_path for download phase

    if code != 0:
        try:
            os.unlink(save_path)
        except OSError:
            pass
        raise RuntimeError(f"spotdl save failed (exit {code}): {stderr[:300]}")

    # Parse the .spotdl JSON file
    try:
        with open(save_path) as f:
            data = json.load(f)
    except Exception as e:
        try:
            os.unlink(save_path)
        except OSError:
            pass
        raise RuntimeError(f"spotdl save file unreadable: {e}")

    songs = data if isinstance(data, list) else data.get("songs", [])
    if not songs:
        try:
            os.unlink(save_path)
        except OSError:
            pass
        log.info("spotdl: no match found for %s - %s", job.artist, job.title)
        return []

    candidates: list[Candidate] = []
    for song in songs[:1]:  # take top match only
        isrc = song.get("isrc") or ""
        year = str(song.get("year") or "")
        album = song.get("album_name") or None
        cover = bool(song.get("cover_url"))

        candidates.append(Candidate(
            source=NAME,
            title=song.get("name") or job.title,
            artist=song.get("artist") or job.artist,
            album=album,
            format="AAC",   # spotdl typically downloads M4A/AAC from YouTube Music
            bitrate=256,
            file_size=None,
            has_cover_art=cover,
            metadata={
                "isrc": isrc,
                "year": year,
                "album": album,
                "track_num": str(song.get("track_number") or ""),
                "genre": (song.get("genres") or [""])[0],
                "title": song.get("name") or job.title,
                "artist": song.get("artist") or job.artist,
            },
            download_ref={"save_path": save_path, "song": song},
        ))

    log.info("spotdl: %d candidates for %s - %s", len(candidates), job.artist, job.title)
    return candidates


_AUDIO_EXTS = {".mp3", ".m4a", ".aac", ".opus", ".ogg", ".flac"}


async def download(candidate: Candidate, dest_dir: str) -> tuple[bool, str | None]:
    ref = candidate.download_ref or {}
    save_path = ref.get("save_path")

    # Use a per-download temp dir to safely detect the output file
    tmp_dir = tempfile.mkdtemp(dir=dest_dir, prefix="spotdl_")

    # Always download by query string — save file causes output-path confusion and
    # the Spotify URI doesn't improve hit rate enough to justify the issues.
    query = f"{candidate.artist} - {candidate.title}"
    cmd = [
        "spotdl", "download", query,
        "--output", tmp_dir,
        "--format", "m4a",
        "--audio", "youtube-music",
        "--overwrite", "force",  # never skip due to cache/existing file
    ]

    def _run():
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        return result.returncode, result.stdout, result.stderr

    async with _SPOTDL_DL_SEM:
        try:
            code, stdout, stderr = await asyncio.to_thread(_run)
        except Exception:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise
        finally:
            if save_path:
                try:
                    os.unlink(save_path)
                except OSError:
                    pass

    if code != 0:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise RuntimeError(f"spotdl download failed (exit {code}): {stderr[:400]}")

    # Find the downloaded audio file — search recursively in case spotdl creates subdirs
    audio_files: list[tuple[float, str]] = []
    for root, _dirs, files in os.walk(tmp_dir):
        for fn in files:
            if Path(fn).suffix.lower() in _AUDIO_EXTS:
                fp = os.path.join(root, fn)
                audio_files.append((os.path.getmtime(fp), fp))

    if not audio_files:
        log.warning("spotdl: no audio file in tmp_dir. stdout=%s stderr=%s",
                    stdout[:300], stderr[:300])
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise RuntimeError(f"spotdl produced no audio file for '{candidate.artist} - {candidate.title}'")

    audio_files.sort(reverse=True)
    src = audio_files[0][1]
    dst = os.path.join(dest_dir, os.path.basename(src))
    shutil.move(src, dst)
    shutil.rmtree(tmp_dir, ignore_errors=True)

    log.info("spotdl: downloaded %s - %s → %s", candidate.artist, candidate.title, dst)
    return True, dst
