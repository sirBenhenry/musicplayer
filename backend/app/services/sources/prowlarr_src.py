"""Prowlarr → qBittorrent source adapter."""
import logging

from ...services import prowlarr, qbittorrent

log = logging.getLogger(__name__)
NAME = "prowlarr"


async def download(job) -> bool:
    """Search Prowlarr and add best result to qBittorrent. Returns True if queued."""
    artist, title = job.artist, job.title

    queries = [
        (f"{artist} {title} FLAC", [3040]),
        (f"{artist} {title}", [3000]),
    ]
    if job.item_type == "album":
        queries = [
            (f"{artist} {title} FLAC", [3040]),
            (f"{artist} {title}", [3000]),
        ]

    for query, cats in queries:
        results = await prowlarr.search(query, categories=cats)
        best = prowlarr.pick_best_result(results)
        if best:
            url = best.get("downloadUrl") or best.get("magnetUrl") or ""
            if not url:
                continue
            h = await qbittorrent.add_torrent(url, category="music", save_path="/data/torrents/music")
            if h:
                job.qb_hash = h
                log.info("prowlarr: queued %s - %s → %s", artist, title, h[:8])
                return True

    log.info("prowlarr: no result for %s - %s", artist, title)
    raise RuntimeError(f"no results from Prowlarr for '{artist} - {title}'")
