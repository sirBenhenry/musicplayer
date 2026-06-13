"""slskd (Soulseek) REST API source adapter."""
import asyncio
import logging
import os

import httpx

from ...core.config import get_settings
from .base import Candidate

log = logging.getLogger(__name__)
NAME = "soulseek"

_SEARCH_TIMEOUT = 90      # poll for up to 90s — slskd needs time to collect peers
_DL_TIMEOUT = 300
_POLL_INTERVAL = 5
_EARLY_EXIT_FILES = 15   # stop polling early once we have this many valid candidates
_AUDIO_EXTS = frozenset([".flac", ".mp3", ".m4a", ".aac", ".opus", ".ogg", ".wav"])
_TERMINAL_SEARCH_STATES = frozenset(["Completed", "Cancelled", "TimedOut", "Errored"])

# Hard cap on concurrent slskd searches — prevents queue buildup that locks the client
_SLSK_SEARCH_SEM: asyncio.Semaphore | None = None


def _search_sem() -> asyncio.Semaphore:
    global _SLSK_SEARCH_SEM
    if _SLSK_SEARCH_SEM is None:
        _SLSK_SEARCH_SEM = asyncio.Semaphore(4)
    return _SLSK_SEARCH_SEM


def _headers():
    return {"X-API-Key": get_settings().SLSKD_API_KEY}


def _base():
    return get_settings().SLSKD_URL.rstrip("/")


async def _check_alive() -> bool:
    """Return True if slskd API is reachable (uses GET /api/v1/searches as a ping)."""
    try:
        async with httpx.AsyncClient(timeout=5, headers=_headers()) as client:
            r = await client.get(f"{_base()}/api/v1/searches")
            if r.status_code == 200:
                return True
            log.warning("soulseek: liveness check got %d", r.status_code)
            return False
    except Exception as e:
        log.warning("soulseek: liveness check failed: %s", e)
        return False


def _parse_format(filename: str) -> tuple[str, int | None]:
    fn = filename.lower()
    if fn.endswith(".flac"):
        return "FLAC", None
    if "320" in fn:
        return "MP3", 320
    if "256" in fn:
        return "MP3", 256
    if "192" in fn:
        return "MP3", 192
    if fn.endswith(".mp3"):
        return "MP3", None
    if fn.endswith(".m4a") or fn.endswith(".aac"):
        return "AAC", None
    if fn.endswith(".ogg"):
        return "OGG", None
    if fn.endswith(".opus"):
        return "OPUS", None
    return "UNKNOWN", None


async def search(job) -> list[Candidate]:
    settings = get_settings()
    if not settings.SLSKD_URL or not settings.SLSKD_API_KEY:
        raise RuntimeError("slskd not configured (SLSKD_URL/SLSKD_API_KEY missing)")

    # Liveness pre-check — fail fast if slskd API is unreachable
    if not await _check_alive():
        raise RuntimeError("slskd API unreachable")

    query = f"{job.artist} {getattr(job, 'search_title', job.title)}"

    async with _search_sem():
        async with httpx.AsyncClient(timeout=15, headers=_headers()) as client:
            r = await client.post(f"{_base()}/api/v1/searches", json={"searchText": query})
            r.raise_for_status()
            search_id = r.json()["id"]

        responses: list[dict] = []
        valid_file_count = 0
        consecutive_errors = 0
        for poll in range(_SEARCH_TIMEOUT // _POLL_INTERVAL):
            await asyncio.sleep(_POLL_INTERVAL)
            try:
                async with httpx.AsyncClient(timeout=15, headers=_headers()) as client:
                    r = await client.get(
                        f"{_base()}/api/v1/searches/{search_id}?includeResponses=true"
                    )
                if r.status_code != 200:
                    log.debug("soulseek: poll %d got status %d — skipping", poll, r.status_code)
                    consecutive_errors += 1
                    if consecutive_errors >= 3:
                        log.warning("soulseek: 3 consecutive poll errors, aborting search")
                        break
                    continue
                data = r.json()
                consecutive_errors = 0
            except Exception as e:
                log.debug("soulseek: poll %d error (continuing): %s", poll, e)
                consecutive_errors += 1
                if consecutive_errors >= 3:
                    log.warning("soulseek: 3 consecutive poll errors, aborting search")
                    break
                continue

            state = data.get("state", "")
            responses = data.get("responses", [])
            valid_file_count = sum(
                1 for resp in responses for f in resp.get("files", [])
                if f.get("size", 0) >= 2_000_000
                and os.path.splitext(f.get("filename", "").lower())[1] in _AUDIO_EXTS
            )
            finished = any(s in state for s in _TERMINAL_SEARCH_STATES)
            if finished or (valid_file_count >= _EARLY_EXIT_FILES and poll >= 2):
                break

        # Clean up search slot immediately — prevents slskd queue buildup
        try:
            async with httpx.AsyncClient(timeout=5, headers=_headers()) as client:
                await client.delete(f"{_base()}/api/v1/searches/{search_id}")
        except Exception:
            pass

    candidates: list[Candidate] = []
    for resp in responses:
        username = resp.get("username", "")
        for f in resp.get("files", []):
            fname = f.get("filename", "")
            size = f.get("size", 0)
            ext = os.path.splitext(fname.lower())[1]
            if size < 2_000_000 or ext not in _AUDIO_EXTS:
                continue
            fmt, bitrate = _parse_format(fname)
            candidates.append(Candidate(
                source=NAME,
                title=job.title,
                artist=job.artist,
                album=None,
                format=fmt,
                bitrate=bitrate,
                file_size=size,
                has_cover_art=False,
                metadata={},
                download_ref={"username": username, "filename": fname, "size": size},
            ))

    log.info("soulseek: %d candidates for %s - %s", len(candidates), job.artist, job.title)
    return candidates


async def download(candidate: Candidate, dest_dir: str) -> tuple[bool, str | None]:
    ref = candidate.download_ref or {}
    username = ref.get("username", "")
    filename = ref.get("filename", "")
    size = ref.get("size", 0)

    if not username or not filename:
        raise RuntimeError("soulseek candidate missing username/filename")

    async with httpx.AsyncClient(timeout=15, headers=_headers()) as client:
        r = await client.post(
            f"{_base()}/api/v1/transfers/downloads/{username}",
            json=[{"filename": filename, "size": size}],
        )
        r.raise_for_status()

    file_path: str | None = None
    for _ in range(_DL_TIMEOUT // _POLL_INTERVAL):
        await asyncio.sleep(_POLL_INTERVAL)
        async with httpx.AsyncClient(timeout=15, headers=_headers()) as client:
            r = await client.get(f"{_base()}/api/v1/transfers/downloads/{username}")
            data = r.json() if r.status_code == 200 else {}

        for directory in data.get("directories", []):
            for t in directory.get("files", []):
                if t.get("filename") == filename:
                    # slskd terminal states are compound, e.g.
                    # "Completed, Succeeded" / "Completed, Errored" /
                    # "Completed, Cancelled" / "Completed, TimedOut" /
                    # "Completed, Rejected". "Completed" alone is NOT success.
                    state = t.get("state", "")
                    if "Succeeded" in state:
                        file_path = _resolve_downloaded_path(filename, dest_dir)
                        log.info("soulseek: downloaded %s - %s -> %s",
                                 candidate.artist, candidate.title, file_path)
                        return True, file_path
                    if any(s in state for s in
                           ("Errored", "Cancelled", "Rejected", "TimedOut", "Failed")):
                        raise RuntimeError(f"Soulseek transfer failed: {state}")

    raise RuntimeError(f"Soulseek download timed out for '{candidate.artist} - {candidate.title}'")


def _resolve_downloaded_path(filename: str, dest_dir: str) -> str:
    """Find where slskd actually wrote the file.

    slskd saves into a subfolder named after the remote share directory, so the
    file lands at dest_dir/<RemoteFolder>/<name>, not flat at dest_dir/<name>.
    Try the flat path first (cheap), else walk dest_dir for the basename and
    take the newest match. Falls back to the flat path so callers always get a
    string (the caller verifies existence).
    """
    local_name = os.path.basename(filename.replace("\\", "/"))
    flat = os.path.join(dest_dir, local_name)
    if os.path.exists(flat):
        return flat
    candidates: list[tuple[float, str]] = []
    for root, _dirs, files in os.walk(dest_dir):
        if local_name in files:
            p = os.path.join(root, local_name)
            try:
                candidates.append((os.path.getmtime(p), p))
            except OSError:
                pass
    if candidates:
        candidates.sort(reverse=True)
        return candidates[0][1]
    return flat
