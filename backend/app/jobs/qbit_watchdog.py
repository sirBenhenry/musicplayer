"""Watchdog: ensure qBittorrent never re-enables uploading/seeding."""
import logging

import httpx

from ..core.config import get_settings

log = logging.getLogger(__name__)

REQUIRED = {
    "up_limit": 1024,
    "max_ratio_enabled": True,
    "max_ratio": 0,
    "max_ratio_act": 1,
    "max_seeding_time_enabled": True,
    "max_seeding_time": 0,
    "dht": False,
    "pex": False,
    "lsd": False,
}


async def _qbit_session() -> str | None:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{settings.QBITTORRENT_URL}/api/v2/auth/login",
                data={"username": settings.QBITTORRENT_USER, "password": settings.QBITTORRENT_PASS},
            )
            return r.cookies.get("SID")
    except Exception as e:
        log.warning("qbit_watchdog: login failed: %s", e)
        return None


async def enforce_no_upload() -> None:
    settings = get_settings()
    sid = await _qbit_session()
    if not sid:
        return

    cookies = {"SID": sid}
    try:
        async with httpx.AsyncClient(timeout=10, cookies=cookies) as client:
            r = await client.get(f"{settings.QBITTORRENT_URL}/api/v2/app/preferences")
            prefs = r.json()

            drift = {k: v for k, v in REQUIRED.items() if prefs.get(k) != v}
            if not drift:
                return

            log.warning("qbit_watchdog: drift detected %s — re-applying", drift)
            await client.post(
                f"{settings.QBITTORRENT_URL}/api/v2/app/setPreferences",
                data={"json": __import__("json").dumps(drift)},
            )
            log.warning("qbit_watchdog: settings re-applied")
    except Exception as e:
        log.warning("qbit_watchdog: check failed: %s", e)
