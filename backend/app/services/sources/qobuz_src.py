"""Qobuz source adapter via streamrip (24-bit FLAC)."""
import asyncio
import logging
import os
import subprocess
from pathlib import Path

from ...core.config import get_settings

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


async def download(job) -> bool:
    settings = get_settings()
    if not settings.QOBUZ_EMAIL or not settings.QOBUZ_PASSWORD:
        raise RuntimeError("Qobuz not configured (QOBUZ_EMAIL/QOBUZ_PASSWORD missing)")

    config_path = _write_config(settings)
    query = f"{job.artist} {job.title}"

    def _run():
        result = subprocess.run(
            ["python", "-m", "streamrip", "--config", str(config_path),
             "search", "qobuz", "track", query, "--max-results", "1"],
            capture_output=True, text=True, timeout=120,
        )
        return result.returncode == 0, result.stderr

    ok, stderr = await asyncio.to_thread(_run)
    if not ok:
        raise RuntimeError(f"streamrip failed: {stderr[:200]}")
    log.info("qobuz: downloaded %s - %s", job.artist, job.title)
    return True
