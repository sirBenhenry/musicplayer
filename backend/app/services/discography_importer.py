"""Download artist discography album-by-album: MusicBrainz → Prowlarr → qBittorrent."""
import asyncio
import logging

from . import musicbrainz, prowlarr, qbittorrent

log = logging.getLogger(__name__)


async def import_artist_discography(artist_name: str, mbid: str) -> int:
    """Fetch every release from MusicBrainz, search Prowlarr for each, add best torrent.

    Runs as a background task. Returns count of successfully queued downloads.
    Skips releases with no torrent found.
    """
    releases = await musicbrainz.get_release_groups(mbid)
    if not releases:
        log.warning("No releases found on MusicBrainz for %s (%s)", artist_name, mbid)
        return 0

    # Sort oldest → newest so library fills in chronological order
    releases.sort(key=lambda r: r.get("first-release-date") or "")

    seen_hashes: set[str] = set()
    queued = 0

    for release in releases:
        title = release.get("title", "").strip()
        rtype = release.get("primary-type", "")
        if not title:
            continue

        log.info("Searching for %s - %s (%s)", artist_name, title, rtype)

        # Try FLAC first, then any audio
        results = await prowlarr.search(f"{artist_name} {title} FLAC", categories=[3040])
        if not results:
            results = await prowlarr.search(f"{artist_name} {title}", categories=[3000])

        best = prowlarr.pick_best_result(results)
        if not best:
            log.info("No torrent found for %s - %s", artist_name, title)
            await asyncio.sleep(0.3)
            continue

        # Prefer Prowlarr's proxied downloadUrl (handles private tracker auth).
        # Fall back to magnetUrl for public trackers.
        magnet = best.get("downloadUrl") or best.get("magnetUrl") or ""
        if not magnet:
            continue

        h = await qbittorrent.add_torrent(
            magnet,
            category="music",
            save_path="/data/torrents/music",
        )
        if h and h not in seen_hashes:
            seen_hashes.add(h)
            queued += 1
            log.info("Queued %s - %s → %s (%d seeders)",
                     artist_name, title, h[:8], best.get("seeders", 0))
        elif h in seen_hashes:
            log.info("Skipped duplicate torrent for %s - %s", artist_name, title)

        await asyncio.sleep(0.5)  # gentle on Prowlarr

    log.info("Discography import done: %d/%d releases queued for %s",
             queued, len(releases), artist_name)
    return queued
