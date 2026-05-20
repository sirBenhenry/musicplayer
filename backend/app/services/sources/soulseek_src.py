"""slskd (Soulseek) REST API source adapter."""
import asyncio
import logging

import httpx

from ...core.config import get_settings

log = logging.getLogger(__name__)
NAME = "soulseek"

_SEARCH_TIMEOUT = 45   # seconds to wait for search results
_DL_TIMEOUT = 300      # seconds to wait for download completion
_POLL_INTERVAL = 5


def _headers():
    return {"X-API-Key": get_settings().SLSKD_API_KEY}


def _base():
    return get_settings().SLSKD_URL.rstrip("/")


def _quality_rank(filename: str, size: int) -> tuple:
    fn = filename.lower()
    if fn.endswith(".flac"):
        return (4, size)
    if "320" in fn or fn.endswith(".mp3"):
        return (2, size)
    if fn.endswith(".m4a") or fn.endswith(".aac"):
        return (1, size)
    return (0, size)


async def download(job) -> bool:
    settings = get_settings()
    if not settings.SLSKD_URL or not settings.SLSKD_API_KEY:
        raise RuntimeError("slskd not configured (SLSKD_URL/SLSKD_API_KEY missing)")

    query = f"{job.artist} {job.title}"
    async with httpx.AsyncClient(timeout=15, headers=_headers()) as client:
        r = await client.post(f"{_base()}/api/v1/searches", json={"searchText": query})
        r.raise_for_status()
        search_id = r.json()["id"]

    # Poll for results — must use ?includeResponses=true to get files
    results = []
    for _ in range(_SEARCH_TIMEOUT // _POLL_INTERVAL):
        await asyncio.sleep(_POLL_INTERVAL)
        async with httpx.AsyncClient(timeout=15, headers=_headers()) as client:
            r = await client.get(f"{_base()}/api/v1/searches/{search_id}?includeResponses=true")
            data = r.json()
        state = data.get("state", "")
        if "Completed" in state or "Cancelled" in state:
            results = data.get("responses", [])
            break

    # Flatten files from all users, pick best
    candidates = []
    for resp in results:
        username = resp.get("username", "")
        for f in resp.get("files", []):
            fname = f.get("filename", "")
            size = f.get("size", 0)
            if size < 2_000_000:
                continue
            candidates.append((username, fname, size))

    if not candidates:
        raise RuntimeError(f"no Soulseek results for '{query}'")

    candidates.sort(key=lambda c: _quality_rank(c[1], c[2]), reverse=True)
    username, filename, size = candidates[0]
    log.info("soulseek: best match user=%s file=%s size=%d", username, filename.split("\\")[-1], size)

    # Request download — API expects an array
    async with httpx.AsyncClient(timeout=15, headers=_headers()) as client:
        r = await client.post(
            f"{_base()}/api/v1/transfers/downloads/{username}",
            json=[{"filename": filename, "size": size}],
        )
        r.raise_for_status()

    # Poll transfer status — response is nested: {username, directories:[{files:[{state,...}]}]}
    for _ in range(_DL_TIMEOUT // _POLL_INTERVAL):
        await asyncio.sleep(_POLL_INTERVAL)
        async with httpx.AsyncClient(timeout=15, headers=_headers()) as client:
            r = await client.get(f"{_base()}/api/v1/transfers/downloads/{username}")
            data = r.json() if r.status_code == 200 else {}

        for directory in data.get("directories", []):
            for t in directory.get("files", []):
                if t.get("filename") == filename:
                    state = t.get("state", "")
                    if "Completed" in state:
                        log.info("soulseek: downloaded %s - %s", job.artist, job.title)
                        return True
                    if "Failed" in state or "Cancelled" in state:
                        raise RuntimeError(f"Soulseek transfer failed: {state}")

    raise RuntimeError(f"Soulseek download timed out for '{job.artist} - {job.title}'")
