"""Prowlarr → qBittorrent source adapter."""
import asyncio
import logging
import re

from ...services import prowlarr, qbittorrent
from .base import Candidate

log = logging.getLogger(__name__)
NAME = "prowlarr"

_FMT_RE = re.compile(r'\bFLAC\b', re.I)
_MP3_RE = re.compile(r'\bMP3\b', re.I)
_BITRATE_RE = re.compile(r'\b(320|256|192|128)\b')


def _parse_format(title: str) -> tuple[str, int | None]:
    if _FMT_RE.search(title):
        return "FLAC", None
    m = _BITRATE_RE.search(title)
    bitrate = int(m.group(1)) if m else None
    if _MP3_RE.search(title) or bitrate:
        return "MP3", bitrate
    return "UNKNOWN", None


async def search(job) -> list[Candidate]:
    artist = job.artist
    title = getattr(job, 'search_title', job.title)
    queries = [
        (f"{artist} {title} FLAC", [3040]),
        (f"{artist} {title}", [3000]),
    ]
    if job.item_type == "album":
        queries = [
            (f"{artist} {title} FLAC", [3040]),
            (f"{artist} {title}", [3000]),
        ]

    async def _run_query(query: str, cats: list[int]) -> list[dict]:
        try:
            return await prowlarr.search(query, categories=cats)
        except Exception as e:
            log.warning("prowlarr: search failed for %r: %s", query, e)
            return []

    all_results = await asyncio.gather(*[_run_query(q, c) for q, c in queries])

    candidates: list[Candidate] = []
    seen_urls: set[str] = set()

    for results in all_results:
        for result in results:
            url = result.get("downloadUrl") or result.get("magnetUrl") or ""
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)

            result_title = result.get("title", "")
            fmt, bitrate = _parse_format(result_title)
            size = result.get("size") or 0

            seeders = result.get("seeders") or 0
            if seeders == 0:
                log.debug("prowlarr: skip 0-seeder result %r", result_title)
                continue

            # Skip album/discography torrents for single-song jobs (single FLAC ≤ ~80MB)
            if job.item_type == "track" and size > 150_000_000:
                log.debug("prowlarr: skip oversized result %r (%dMB)", result_title, size // 1_000_000)
                continue

            candidates.append(Candidate(
                # Score against the REAL torrent name, not the query echo — using
                # title=job.title made identity scoring compare the query to
                # itself and pass even wrong torrents (SRC-6). Fuzzy matching
                # handles noisy names like "Artist - Title [FLAC] 2019".
                source=NAME,
                title=result_title or title,
                artist=artist,
                album=None,
                format=fmt,
                bitrate=bitrate,
                file_size=size,
                has_cover_art=False,
                metadata={"query_title": title},
                download_ref={"url": url, "title": result_title},
            ))

    log.info("prowlarr: %d candidates for %s - %s", len(candidates), artist, title)
    return candidates


async def download(candidate: Candidate, dest_dir: str) -> tuple[bool, str | None]:
    ref = candidate.download_ref or {}
    url = ref.get("url", "")
    if not url:
        raise RuntimeError("prowlarr candidate has no download URL")

    h = await qbittorrent.add_torrent(url, category="music", save_path="/data/music/torrents/music")
    if not h:
        raise RuntimeError(f"qBittorrent rejected torrent for {candidate.artist} - {candidate.title}")

    # Store hash on the candidate so the pipeline can persist it on the job
    candidate.download_ref["qb_hash"] = h
    log.info("prowlarr: queued %s - %s → %s", candidate.artist, candidate.title, h[:8])
    # File path unknown until torrent completes — poller handles completion
    return True, None
