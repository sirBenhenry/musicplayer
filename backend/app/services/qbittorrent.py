"""qBittorrent WebAPI client."""
import logging

import httpx

from ..core.config import get_settings

settings = get_settings()
log = logging.getLogger(__name__)

_cookie_name: str | None = None
_cookie_value: str | None = None


async def _get_cookie() -> tuple[str, str]:
    global _cookie_name, _cookie_value
    if _cookie_name and _cookie_value:
        return _cookie_name, _cookie_value
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{settings.QBITTORRENT_URL}/api/v2/auth/login",
            data={"username": settings.QBITTORRENT_USER, "password": settings.QBITTORRENT_PASS},
        )
        # qBittorrent 4.6+ returns 204 empty; older versions return 200 "Ok."
        if r.status_code in (200, 204) and r.text in ("Ok.", ""):
            # Newer qBittorrent uses QBT_SID_<port>; older uses SID
            for name, value in r.cookies.items():
                if value:
                    _cookie_name = name
                    _cookie_value = value
                    return name, value
        raise RuntimeError(f"qBittorrent login failed: {r.status_code} {r.text!r}")


async def _req(method: str, path: str, **kwargs) -> httpx.Response:
    global _cookie_name, _cookie_value
    name, value = await _get_cookie()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.request(
            method,
            f"{settings.QBITTORRENT_URL}/api/v2{path}",
            cookies={name: value},
            **kwargs,
        )
        if r.status_code == 403:
            _cookie_name = _cookie_value = None
            name, value = await _get_cookie()
            r = await client.request(
                method,
                f"{settings.QBITTORRENT_URL}/api/v2{path}",
                cookies={name: value},
                **kwargs,
            )
        return r


async def add_torrent(url: str, category: str = "music", save_path: str | None = None) -> str | None:
    """Add torrent by magnet/URL. Returns info hash or None on failure."""
    data: dict = {"urls": url, "category": category, "autoTMM": "false"}
    if save_path:
        data["savepath"] = save_path
    try:
        r = await _req("POST", "/torrents/add", data=data)
        # qBittorrent <5: returns "Ok." text on success
        # qBittorrent >=5: returns JSON {"success_count":N,"pending_count":N,"failure_count":N}
        added = False
        if r.text.lower().strip() in ("ok.", "ok"):
            added = True
        else:
            try:
                j = r.json()
                if isinstance(j, dict) and j.get("failure_count", 0) == 0 and \
                        (j.get("success_count", 0) > 0 or j.get("pending_count", 0) > 0):
                    added = True
            except Exception:
                pass

        if added:
            await __import__("asyncio").sleep(1)  # let qBittorrent register the torrent
            torrents = await get_torrents(category=category, filter="all")
            for t in torrents:
                if t.get("magnet_uri", "").startswith(url[:40]) or url in t.get("magnet_uri", ""):
                    return t["hash"]
            if torrents:
                return torrents[-1]["hash"]
        else:
            log.error("qBittorrent add_torrent unexpected response: %s", r.text)
    except Exception as e:
        log.error("qBittorrent add_torrent failed: %s", e)
    return None


async def get_torrents(category: str = "music", filter: str = "completed") -> list[dict]:
    """List torrents by category and filter (all|downloading|completed|paused|etc)."""
    try:
        r = await _req("GET", "/torrents/info", params={"category": category, "filter": filter})
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.error("qBittorrent get_torrents failed: %s", e)
        return []
