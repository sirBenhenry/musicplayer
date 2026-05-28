"""Qobuz source adapter via streamrip (24-bit FLAC)."""
import asyncio
import logging
import subprocess
from pathlib import Path

from ...core.config import get_settings
from .base import Candidate

log = logging.getLogger(__name__)
NAME = "qobuz"


def _write_config(settings) -> Path:
    config_dir = Path(settings.STREAMRIP_CONFIG_DIR)
    config_dir.mkdir(parents=True, exist_ok=True)
    config_path = config_dir / "config.toml"
    config_path.write_text(
        f"""[qobuz]
email_or_userid = "{settings.QOBUZ_EMAIL}"
password_or_token = "{settings.QOBUZ_PASSWORD}"
quality = 3
download_booklets = false

[downloads]
folder = "{settings.MUSIC_DIR}"
"""
    )
    return config_path


async def search(job) -> list[Candidate]:
    settings = get_settings()
    if not settings.QOBUZ_EMAIL or not settings.QOBUZ_PASSWORD:
        raise RuntimeError("Qobuz not configured (QOBUZ_EMAIL/QOBUZ_PASSWORD missing)")

    # Return a synthetic candidate — streamrip does search+download atomically.
    # We represent it as a high-confidence candidate; actual download validates existence.
    return [Candidate(
        source=NAME,
        title=job.title,
        artist=job.artist,
        album=None,
        format="FLAC",
        bitrate=None,
        file_size=None,
        has_cover_art=True,
        metadata={},
        download_ref={"query": f"{job.artist} {job.title}"},
    )]


async def download(candidate: Candidate, dest_dir: str) -> tuple[bool, str | None]:
    settings = get_settings()
    if not settings.QOBUZ_EMAIL or not settings.QOBUZ_PASSWORD:
        raise RuntimeError("Qobuz not configured (QOBUZ_EMAIL/QOBUZ_PASSWORD missing)")

    config_path = _write_config(settings)
    query = (candidate.download_ref or {}).get("query", f"{candidate.artist} {candidate.title}")

    def _run():
        result = subprocess.run(
            ["python", "-m", "streamrip", "--config", str(config_path),
             "search", "qobuz", "track", query, "--max-results", "1"],
            capture_output=True, text=True, timeout=120,
        )
        return result.returncode == 0, result.stdout, result.stderr

    ok, stdout, stderr = await asyncio.to_thread(_run)
    if not ok:
        raise RuntimeError(f"streamrip failed (exit non-zero): {stderr[:400]}")

    log.info("qobuz: downloaded %s - %s", candidate.artist, candidate.title)
    # streamrip writes to MUSIC_DIR — we don't know exact path without parsing stdout
    return True, None
