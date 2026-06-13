"""Spotify playlist/album/track import via spotdl save command."""
import asyncio
import json
import logging
import os
import subprocess
import tempfile

log = logging.getLogger(__name__)


async def fetch_spotify_playlist(url: str) -> tuple[str | None, list[dict]]:
    """
    Run `spotdl save <url>` and return (playlist_name, songs_list).
    Each song dict has keys: name, artist, artists, album_name, isrc, year, cover_url, etc.
    Raises RuntimeError on failure.
    """
    with tempfile.NamedTemporaryFile(suffix=".spotdl", delete=False) as tf:
        save_path = tf.name

    def _run():
        result = subprocess.run(
            ["spotdl", "save", url, "--save-file", save_path, "--output", "/tmp"],
            capture_output=True, text=True, timeout=120,
        )
        return result.returncode, result.stdout, result.stderr

    try:
        code, stdout, stderr = await asyncio.to_thread(_run)
    except subprocess.TimeoutExpired:
        try:
            os.unlink(save_path)
        except OSError:
            pass
        raise RuntimeError("spotdl save timed out after 120s")
    except FileNotFoundError:
        raise RuntimeError("spotdl is not installed in container")

    if code != 0:
        try:
            os.unlink(save_path)
        except OSError:
            pass
        raise RuntimeError(f"spotdl save failed (exit {code}): {stderr[:400]}")

    try:
        with open(save_path) as f:
            data = json.load(f)
    except Exception as e:
        raise RuntimeError(f"spotdl output unreadable: {e}")
    finally:
        try:
            os.unlink(save_path)
        except OSError:
            pass

    playlist_name: str | None = None
    if isinstance(data, list):
        songs = data
        # spotdl save writes a flat list of song objects, each carrying the
        # source playlist name in `list_name` — read it so the UserPlaylist
        # gets the real name instead of "Imported Playlist".
        if songs and isinstance(songs[0], dict):
            playlist_name = songs[0].get("list_name") or songs[0].get("list")
    elif isinstance(data, dict):
        songs = data.get("songs", [])
        playlist_name = data.get("name") or data.get("list_name") or data.get("list")
    else:
        raise RuntimeError("Unexpected spotdl output format")

    if not songs:
        raise RuntimeError("No tracks found at that Spotify URL")

    log.info("spotify_import: fetched %d tracks from %s (name=%r)", len(songs), url, playlist_name)
    return playlist_name, songs
