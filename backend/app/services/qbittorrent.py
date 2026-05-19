"""qBittorrent WebAPI client."""
import logging

import httpx

from ..core.config import get_settings

settings = get_settings()
log = logging.getLogger(__name__)

_cookie: str | None = None


async def _get_cookie() -> str:
    global _cookie
    if _cookie:
        return _cookie
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{settings.QBITTORRENT_URL}/api/v2/auth/login",
            data={"username": settings.QBITTORRENT_USER, "password": settings.QBITTORRENT_PASS},
        )
        if r.text == "Ok.":
            _cookie = r.cookies.get("SID", "")
            return _cookie
        raise RuntimeError(f"qBittorrent login failed: {r.text}")


async def _req(method: str, path: str, **kwargs) -> httpx.Response:
    global _cookie
    sid = await _get_cookie()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.request(
            method,
            f"{settings.QBITTORRENT_URL}/api/v2{path}",
            cookies={"SID": sid},
            **kwargs,
        )
        if r.status_code == 403:
            _cookie = None
            sid = await _get_cookie()
            r = await client.request(
                method,
                f"{settings.QBITTORRENT_URL}/api/v2{path}",
                cookies={"SID": sid},
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
        if r.text.lower() in ("ok.", "ok"):
            torrents = await get_torrents(category=category, filter="all")
            # Find the torrent we just added by matching url
            for t in torrents:
                if t.get("magnet_uri", "").startswith(url[:40]) or url in t.get("magnet_uri", ""):
                    return t["hash"]
            # fallback — return latest
            if torrents:
                return torrents[-1]["hash"]
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
