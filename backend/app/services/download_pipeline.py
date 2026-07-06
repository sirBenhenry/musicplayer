"""Central download pipeline: parallel source search → confidence scoring → best candidate wins."""
import asyncio
import logging
import os
import types
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import AsyncSessionLocal
from ..models.events import DownloadJob, UserNotification
from .scoring import ScoreBreakdown, score_candidate, score_predownload, is_acceptable, review_status_for
from .sources.base import Candidate
from .sources import prowlarr_src, soulseek_src, youtube_src, archive_org_src

import re as _re

log = logging.getLogger(__name__)

_MB_PREFIX_RE = _re.compile(
    r'^mb:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*',
    _re.IGNORECASE,
)

_BACKOFF_MINUTES = [15, 30, 60, 120, 240, 480, 720, 1440, 2880]
_PIPELINE_SEM: asyncio.Semaphore | None = None


def _pipeline_sem() -> asyncio.Semaphore:
    global _PIPELINE_SEM
    if _PIPELINE_SEM is None:
        _PIPELINE_SEM = asyncio.Semaphore(4)
    return _PIPELINE_SEM


def _strip_version_suffix(title: str) -> str:
    """Strip trailing parenthetical version tags so sources can find the canonical song.

    'Beat It (Michael Jackson\'s Vision)' → 'Beat It'
    'Thriller (2008 Remaster)'            → 'Thriller'
    Loops to handle stacked suffixes like 'Title (Live) (Remaster)'.
    """
    t = title
    while True:
        stripped = _re.sub(r'\s*\([^)]+\)\s*$', '', t).strip()
        if stripped == t or not stripped:
            break
        t = stripped
    return t
_MAX_RETRIES = len(_BACKOFF_MINUTES)
_MAX_DOWNLOAD_ATTEMPTS = 5    # try top-N candidates before giving up

# Per-source search timeouts — wait long enough for slow sources (prowlarr queries 12 indexers)
_SOURCE_TIMEOUTS: dict[str, float] = {
    "qobuz":    30,
    "prowlarr": 120,   # indexer searches are inherently slow; worth waiting for FLAC
    "soulseek": 600,   # slskd manages its own 90s polling + Semaphore(4) queue;
                       # a tight cap would cancel searches still waiting for a slot
    "spotdl":   60,
    "youtube":  30,
    "archive":  30,
}
_SOURCE_TIMEOUT_DEFAULT = 60


@asynccontextmanager
async def _db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


def _get_all_sources() -> list:
    from ..core.config import get_settings
    from .sources import qobuz_src, spotdl_src
    settings = get_settings()
    sources = [prowlarr_src, soulseek_src, spotdl_src, youtube_src, archive_org_src]
    if settings.QOBUZ_EMAIL and settings.QOBUZ_PASSWORD:
        sources.insert(0, qobuz_src)
    return sources


def _log_step(log_entries: list, step: str, status: str, message: str, data: dict | None = None):
    log_entries.append({
        "step": step,
        "ts": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "message": message,
        "data": data or {},
    })


async def _read_file_tags(file_path: str) -> dict:
    """Read ID3/Vorbis/MP4 tags from a file using mutagen. Never raises."""
    if not file_path or not os.path.exists(file_path):
        return {}
    try:
        import mutagen
        audio = mutagen.File(file_path, easy=True)
        if not audio:
            return {}
        tags: dict = {}
        for key in ("title", "artist", "album", "date", "tracknumber", "genre",
                    "isrc", "musicbrainz_recordingid"):
            val = audio.get(key)
            if val:
                tags[key if key != "date" else "year"] = str(val[0]) if isinstance(val, list) else str(val)
        # cover art detection (non-easy)
        try:
            raw = mutagen.File(file_path)
            if raw:
                pics = raw.tags.getall("APIC") if hasattr(raw.tags, "getall") else []
                if not pics:
                    # MP4 / FLAC
                    pics = raw.get("covr") or raw.get("metadata_block_picture") or []
                tags["has_cover_art"] = bool(pics)
        except Exception:
            pass
        return tags
    except Exception as e:
        log.warning("tag read failed for %s: %s", file_path, e)
        return {}


async def _write_mb_tags(file_path: str, mb_recording: dict) -> bool:
    """Write MusicBrainz metadata into file tags. Called after identity confirmed. Never raises."""
    if not file_path or not mb_recording:
        return False
    try:
        import mutagen
        audio = mutagen.File(file_path, easy=True)
        if not audio:
            return False
        if mb_recording.get("title"):
            audio["title"] = [mb_recording["title"]]
        if mb_recording.get("artist_name"):
            audio["artist"] = [mb_recording["artist_name"]]
        if mb_recording.get("release_title"):
            audio["album"] = [mb_recording["release_title"]]
        if mb_recording.get("isrc"):
            audio["isrc"] = [mb_recording["isrc"]]
        if mb_recording.get("recording_id"):
            audio["musicbrainz_recordingid"] = [mb_recording["recording_id"]]
        audio.save()
        return True
    except Exception as e:
        log.warning("_write_mb_tags failed for %s: %s", file_path, e)
        return False


async def _caa_fetch(client, release_id: str) -> tuple[bytes | None, str]:
    """Try Cover Art Archive for a single release. Returns (bytes, mime) or (None, '')."""
    try:
        r = await client.get(f"https://coverartarchive.org/release/{release_id}/front")
        if r.status_code == 200:
            mime = "image/png" if "png" in r.headers.get("content-type", "") else "image/jpeg"
            return r.content, mime
    except Exception:
        pass
    return None, ""


async def _fetch_and_embed_cover(
    file_path: str,
    artist: str,
    title: str,
    album: str | None,
    mb_release_id: str | None,
    mb_recording_id: str | None = None,
) -> bool:
    """Fetch cover art and embed it into the audio file. Returns True if embedded.

    Source chain (stops at first hit):
    1. CAA — direct mb_release_id
    2. CAA — all releases from mb_recording_id (MB recording lookup)
    3. CAA — MB text search by artist+title → releases
    4. Deezer search API (free, no key)
    5. iTunes Search API (free, no key)
    6. Last.fm track.getInfo (only if LASTFM_API_KEY set)
    """
    import httpx
    import urllib.parse
    image_bytes: bytes | None = None
    image_mime = "image/jpeg"

    _MB_HEADERS = {"User-Agent": "MusicApp/1.0 (ben@gonnet.ch)"}
    _MB_BASE = "https://musicbrainz.org/ws/2"

    async with httpx.AsyncClient(timeout=12, follow_redirects=True, headers=_MB_HEADERS) as client:

        # 1. CAA direct release ID
        if mb_release_id and not image_bytes:
            image_bytes, image_mime = await _caa_fetch(client, mb_release_id)

        # 2. CAA via recording → ALL releases (not just first)
        if mb_recording_id and not image_bytes:
            try:
                r = await client.get(
                    f"{_MB_BASE}/recording/{mb_recording_id}",
                    params={"inc": "releases", "fmt": "json"},
                )
                if r.status_code == 200:
                    releases = r.json().get("releases", [])
                    for rel in releases[:6]:
                        rid = rel.get("id")
                        if rid and rid != mb_release_id:
                            image_bytes, image_mime = await _caa_fetch(client, rid)
                            if image_bytes:
                                break
            except Exception as e:
                log.debug("cover: MB recording releases failed: %s", e)

        # 3. CAA via MB text search (artist+title → recording → releases)
        if not image_bytes and artist and title:
            try:
                q = urllib.parse.quote(f'recording:"{title}" AND artist:"{artist}"')
                r = await client.get(
                    f"{_MB_BASE}/recording?query={q}&limit=3&fmt=json",
                )
                if r.status_code == 200:
                    recordings = r.json().get("recordings", [])
                    for rec in recordings[:3]:
                        for rel in (rec.get("releases") or [])[:4]:
                            rid = rel.get("id")
                            if rid and rid not in (mb_release_id,):
                                image_bytes, image_mime = await _caa_fetch(client, rid)
                                if image_bytes:
                                    break
                        if image_bytes:
                            break
            except Exception as e:
                log.debug("cover: MB text search failed for '%s - %s': %s", artist, title, e)

        # 4. Deezer — free, no key, good coverage
        if not image_bytes and artist and title:
            try:
                q = urllib.parse.quote(f"{artist} {title}")
                r = await client.get(f"https://api.deezer.com/search?q={q}&limit=3")
                if r.status_code == 200:
                    data = r.json().get("data", [])
                    cover_url = next(
                        (item["album"]["cover_xl"] for item in data
                         if item.get("album", {}).get("cover_xl")),
                        None,
                    )
                    if cover_url:
                        r2 = await client.get(cover_url)
                        if r2.status_code == 200 and len(r2.content) > 1000:
                            image_bytes = r2.content
                            image_mime = "image/jpeg"
            except Exception as e:
                log.debug("cover: Deezer failed for '%s - %s': %s", artist, title, e)

        # 5. iTunes Search API
        if not image_bytes and artist and title:
            try:
                q = urllib.parse.quote(f"{artist} {title}")
                r = await client.get(
                    f"https://itunes.apple.com/search?term={q}&media=music&entity=musicTrack&limit=5"
                )
                if r.status_code == 200:
                    results = r.json().get("results", [])
                    url = next(
                        (res["artworkUrl100"].replace("100x100bb", "600x600bb")
                         for res in results if res.get("artworkUrl100")),
                        None,
                    )
                    if url:
                        r2 = await client.get(url)
                        if r2.status_code == 200 and len(r2.content) > 1000:
                            image_bytes = r2.content
            except Exception as e:
                log.debug("cover: iTunes failed for '%s - %s': %s", artist, title, e)

        # 6. Last.fm — only if key configured
        if not image_bytes:
            try:
                from .lastfm import _call as _lfm_call
                settings = get_settings()
                if getattr(settings, "LASTFM_API_KEY", None):
                    data = await _lfm_call("track.getInfo", artist=artist, track=title, autocorrect=1)
                    images = data.get("track", {}).get("album", {}).get("image", [])
                    url = next((i["#text"] for i in reversed(images) if i.get("#text")), None)
                    if url:
                        r = await client.get(url)
                        if r.status_code == 200 and len(r.content) > 1000:
                            image_bytes = r.content
            except Exception as e:
                log.debug("cover: Last.fm failed for '%s - %s': %s", artist, title, e)

    if not image_bytes:
        return False

    # Embed into file
    try:
        ext = os.path.splitext(file_path)[1].lower()
        if ext == ".flac":
            from mutagen.flac import FLAC, Picture
            audio = FLAC(file_path)
            pic = Picture()
            pic.type = 3  # front cover
            pic.mime = image_mime
            pic.data = image_bytes
            audio.clear_pictures()
            audio.add_picture(pic)
            audio.save()
        elif ext == ".mp3":
            from mutagen.id3 import ID3, APIC, ID3NoHeaderError
            try:
                audio = ID3(file_path)
            except ID3NoHeaderError:
                audio = ID3()
            audio.delall("APIC")
            audio.add(APIC(encoding=3, mime=image_mime, type=3, desc="Cover", data=image_bytes))
            audio.save(file_path)
        elif ext in (".m4a", ".aac", ".mp4"):
            from mutagen.mp4 import MP4, MP4Cover
            audio = MP4(file_path)
            fmt = MP4Cover.FORMAT_PNG if "png" in image_mime else MP4Cover.FORMAT_JPEG
            audio["covr"] = [MP4Cover(image_bytes, imageformat=fmt)]
            audio.save()
        elif ext in (".ogg", ".opus"):
            from mutagen.flac import Picture
            import base64
            if ext == ".opus":
                from mutagen.oggopus import OggOpus
                audio = OggOpus(file_path)
            else:
                from mutagen.oggvorbis import OggVorbis
                audio = OggVorbis(file_path)
            pic = Picture()
            pic.type = 3
            pic.mime = image_mime
            pic.data = image_bytes
            audio["metadata_block_picture"] = [base64.b64encode(pic.write()).decode("ascii")]
            audio.save()
        else:
            return False
        return True
    except Exception as e:
        log.warning("cover embed failed for %s: %s", file_path, e)
        return False


async def request_download(
    db: AsyncSession,
    item_type: str,
    artist: str,
    title: str = "",
    playlist_id: Optional[uuid.UUID] = None,
    mb_recording_id: Optional[str] = None,
    mb_artist_id: Optional[str] = None,
    user_playlist_id: Optional[uuid.UUID] = None,
    profile_id: Optional[uuid.UUID] = None,
) -> DownloadJob:
    """Create a DownloadJob and kick off the parallel pipeline immediately.

    Dedup: if a non-exhausted/failed job already exists for the same artist+title
    (case-insensitive), return that job instead of creating a duplicate.

    Title may be prefixed with 'mb:UUID' to inline the MusicBrainz recording ID:
        title = "mb:f3a07d8f-... Song Title"   → extracts MBID, keeps "Song Title"
        title = "mb:f3a07d8f-..."              → extracts MBID, title fetched from MB
    """
    # Parse inline mb:UUID prefix from title
    m = _MB_PREFIX_RE.match(title)
    if m and not mb_recording_id:
        mb_recording_id = m.group(1)
        title = title[m.end():].strip()  # remainder is optional title hint; may be ""
        if not title:
            title = f"[mb:{mb_recording_id[:8]}]"  # placeholder until MB resolution fills it in
        log.debug("request_download: parsed inline mb_recording_id=%s, title=%r", mb_recording_id, title)

    from sqlalchemy import func as _func, and_
    existing = await db.execute(
        select(DownloadJob).where(
            and_(
                _func.lower(DownloadJob.artist) == artist.strip().lower(),
                _func.lower(DownloadJob.title) == title.strip().lower(),
                DownloadJob.status.in_(["queued", "downloading", "completed"]),
            )
        ).limit(1)
    )
    dup = existing.scalars().first()
    if dup:
        if dup.status in ("queued", "downloading"):
            log.info("request_download: dedup — %s - %s already in progress (%s)", artist, title, dup.status)
            return dup
        if dup.status == "completed" and dup.file_path and os.path.exists(dup.file_path):
            log.info("request_download: dedup — %s - %s already downloaded", artist, title)
            if profile_id and dup.file_path:
                from ..core.config import get_settings as _gs
                from ..models.library import Song as _Song
                _music_dir = _gs().MUSIC_DIR
                _rel = dup.file_path[len(_music_dir)+1:] if dup.file_path.startswith(_music_dir+"/") else dup.file_path
                _sq = await db.execute(select(_Song).where(_Song.file_path == _rel))
                _song = _sq.scalar_one_or_none()
                if _song:
                    _song.profile_id = profile_id
                    _song.needs_profile_assignment = False
                    log.info("request_download: dedup assigned profile %s → '%s - %s'", profile_id, artist, title)
            return dup

    # Check songs table — catches library songs with no download job (original Navidrome
    # library, or songs whose jobs were cleaned up).
    from sqlalchemy import or_ as _or
    from ..models.library import Song as _Song, Artist as _Artist
    _lib_q = await db.execute(
        select(_Song)
        .join(_Artist, _Song.artist_id == _Artist.id, isouter=True)
        .where(
            _func.lower(_Song.title) == title.strip().lower(),
            _or(
                _func.lower(_func.coalesce(_Song.display_artist, "")) == artist.strip().lower(),
                _func.lower(_func.coalesce(_Artist.name, "")) == artist.strip().lower(),
            ),
        )
        .limit(1)
    )
    _existing_song = _lib_q.scalar_one_or_none()
    if _existing_song:
        log.info("request_download: already in library — %s - %s, skipping", artist, title)
        if profile_id and not _existing_song.profile_id:
            _existing_song.profile_id = profile_id
            _existing_song.needs_profile_assignment = False
        # Return a synthetic completed job so callers get a valid object back
        _skip_job = DownloadJob(
            item_type=item_type,
            artist=artist,
            title=title,
            status="completed",
            sources_tried=[],
            retry_count=0,
            playlist_id=playlist_id,
            user_playlist_id=user_playlist_id,
            profile_id=profile_id,
            mb_recording_id=mb_recording_id,
            candidates=[],
            pipeline_log=[{"step": "skipped", "ts": datetime.now(timezone.utc).isoformat(),
                            "status": "ok", "message": "Song already exists in library", "data": {}}],
        )
        db.add(_skip_job)
        await db.flush()
        await db.refresh(_skip_job)
        return _skip_job

    job = DownloadJob(
        item_type=item_type,
        artist=artist,
        title=title,
        status="queued",
        sources_tried=[],
        retry_count=0,
        playlist_id=playlist_id,
        user_playlist_id=user_playlist_id,
        profile_id=profile_id,
        mb_recording_id=mb_recording_id,
        mb_artist_id=mb_artist_id,
        candidates=[],
        pipeline_log=[],
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)
    job_id = job.id
    await db.commit()
    from ..core.tasks import spawn
    spawn(_run_pipeline(job_id), name=f"pipeline-{job_id}")
    return job


async def retry_job(job_id: uuid.UUID) -> None:
    """Reset a failed/exhausted job and re-run immediately."""
    async with _db() as db:
        job = await db.get(DownloadJob, job_id)
        if not job:
            return
        job.status = "queued"
        job.sources_tried = []
        job.last_error = None
        job.retry_count = 0
        job.next_retry_at = None
        job.candidates = []
        job.pipeline_log = []
        job.selected_candidate = None
        job.confidence_score = None
        job.quality_score = None
        job.review_status = None
    from ..core.tasks import spawn
    spawn(_run_pipeline(job_id), name=f"pipeline-{job_id}")


async def _run_pipeline(job_id: uuid.UUID) -> None:
    """Parallel source search → score all candidates → download winner."""
    async with _pipeline_sem():
        await _run_pipeline_inner(job_id)


async def _run_pipeline_inner(job_id: uuid.UUID) -> None:
    pipeline_log: list[dict] = []

    # ── Load job ─────────────────────────────────────────────────────────────
    async with _db() as db:
        job = await db.get(DownloadJob, job_id)
        if not job or job.status not in ("queued",):
            return

        # Deduplicate: if another completed job for same artist+title has a live file, reuse it
        from sqlalchemy import and_
        dup_result = await db.execute(
            select(DownloadJob).where(
                and_(
                    DownloadJob.artist == job.artist,
                    DownloadJob.title == job.title,
                    DownloadJob.status == "completed",
                    DownloadJob.file_path.isnot(None),
                    DownloadJob.id != job.id,
                )
            )
        )
        dup = dup_result.scalars().first()
        if dup and dup.file_path and os.path.exists(dup.file_path):
            job.status = "completed"
            job.file_path = dup.file_path
            job.confidence_score = dup.confidence_score
            job.quality_score = dup.quality_score
            job.source_used = dup.source_used
            job.pipeline_log = [{"step": "deduplicated", "ts": datetime.now(timezone.utc).isoformat(),
                                  "status": "ok", "message": f"File already downloaded by job {dup.id}", "data": {}}]
            log.info("pipeline: dedup %s - %s → reusing file from job %s", job.artist, job.title, dup.id)
            return

        job.status = "downloading"
        ctx = types.SimpleNamespace(
            id=job.id,
            artist=job.artist,
            title=job.title,
            search_title=_strip_version_suffix(job.title),  # used by sources for queries
            item_type=job.item_type,
            mb_recording_id=job.mb_recording_id,
            mb_artist_id=job.mb_artist_id,
        )

    _log_step(pipeline_log, "started", "ok", f"Pipeline started for {ctx.artist} - {ctx.title}")
    await _persist_log(job_id, pipeline_log)

    # ── MusicBrainz resolution ────────────────────────────────────────────────
    mb_recording: dict = {}
    try:
        from .musicbrainz import search_recordings, get_recording
        if ctx.mb_recording_id:
            mb_recording = await get_recording(ctx.mb_recording_id)
            _log_step(pipeline_log, "mb_resolved", "ok",
                      f"MB recording fetched: {mb_recording.get('title')} / ISRC={mb_recording.get('isrc')}",
                      {"mb_recording_id": ctx.mb_recording_id})
        else:
            results = await search_recordings(f"{ctx.artist} - {ctx.title}", limit=5)
            if results:
                best = results[0]
                ctx.mb_recording_id = best.get("mb_recording_id") or ""
                if ctx.mb_recording_id:
                    mb_recording = await get_recording(ctx.mb_recording_id)
                _log_step(pipeline_log, "mb_resolved", "ok",
                          f"MB search matched: {best.get('title')} by {best.get('artist')}",
                          {"mb_recording_id": ctx.mb_recording_id, "match": best})
            else:
                _log_step(pipeline_log, "mb_resolved", "warn",
                          "No MusicBrainz match found — scoring without identity reference")
    except Exception as e:
        _log_step(pipeline_log, "mb_resolved", "error", f"MB resolution failed: {e}")
        log.exception("pipeline: MB resolution failed for %s - %s", ctx.artist, ctx.title)

    await _persist_log(job_id, pipeline_log, mb_recording_id=ctx.mb_recording_id,
                       mb_artist_id=mb_recording.get("artist_mbid"),
                       mb_release_id=mb_recording.get("release_mbid"))

    # ── Parallel source search ────────────────────────────────────────────────
    sources = _get_all_sources()
    source_log: dict[str, str] = {}

    async def _search_source(src) -> list[Candidate]:
        # Per-source cap lives in _SOURCE_TIMEOUTS (soulseek=600 reflects its own
        # internal 90s polling + Semaphore(4) queue — a tight cap would cancel
        # searches still waiting for a slot).
        timeout = _SOURCE_TIMEOUTS.get(src.NAME, _SOURCE_TIMEOUT_DEFAULT)
        try:
            results = await asyncio.wait_for(src.search(ctx), timeout=timeout)
            source_log[src.NAME] = f"{len(results)} candidates"
            return results
        except asyncio.TimeoutError:
            source_log[src.NAME] = f"timeout after {timeout}s"
            log.warning("pipeline: %s timed out (%ds) for %s - %s", src.NAME, timeout, ctx.artist, ctx.title)
            return []
        except Exception as e:
            source_log[src.NAME] = f"error: {e}"
            log.warning("pipeline: %s search failed for %s - %s: %s", src.NAME, ctx.artist, ctx.title, e)
            return []

    raw_results = await asyncio.gather(*[_search_source(s) for s in sources])
    all_candidates: list[Candidate] = [c for batch in raw_results for c in batch]

    _log_step(pipeline_log, "sources_searched", "ok",
              f"Searched {len(sources)} sources, got {len(all_candidates)} total candidates",
              {"per_source": source_log})
    await _persist_log(job_id, pipeline_log)

    if not all_candidates:
        _log_step(pipeline_log, "no_candidates", "error",
                  "All sources returned no candidates — scheduling retry")
        await _handle_failure(job_id, "No candidates from any source", pipeline_log)
        return

    # ── Rank candidates by pre-download score (identity+quality+source, max 80) ─
    scored: list[tuple[float, Candidate]] = []
    scored_breakdowns: dict[int, dict] = {}  # index → scores dict for serialization
    for cand in all_candidates:
        try:
            pre_bd = score_predownload(cand, mb_recording or None)
            scored.append((pre_bd.total, cand))
            scored_breakdowns[id(cand)] = pre_bd.to_dict()
        except Exception as e:
            log.warning("pipeline: pre-scoring failed for %s/%s: %s", cand.source, cand.title, e)

    scored.sort(key=lambda x: x[0], reverse=True)

    candidates_serialized = [
        {**c.to_dict(), "predownload_score": s, "scores": scored_breakdowns.get(id(c), {})}
        for s, c in scored
    ]
    _log_step(pipeline_log, "candidates_scored", "ok",
              f"Ranked {len(scored)} candidates; top={scored[0][0]:.1f} from {scored[0][1].source}",
              {"top_candidates": candidates_serialized[:10]})
    await _persist_candidates(job_id, pipeline_log, candidates_serialized)

    # ── Download loop: try top-N, reject on quality gates, embed cover art ─────
    from ..core.config import get_settings
    settings = get_settings()
    dest_dir = settings.MUSIC_DIR

    downloaded_path: str | None = None
    winner_breakdown: ScoreBreakdown | None = None
    winner_candidate: Candidate | None = None

    source_map = {s.NAME: s for s in sources}
    mb_release_id = mb_recording.get("release_mbid") if mb_recording else None

    for pre_score, cand in scored[:_MAX_DOWNLOAD_ATTEMPTS]:
        src = source_map.get(cand.source)
        if not src:
            continue
        file_path: str | None = None
        try:
            _log_step(pipeline_log, "download_attempt", "ok",
                      f"Attempting download via {cand.source} (pre_score={pre_score:.1f})",
                      {"source": cand.source, "format": cand.format, "bitrate": cand.bitrate})
            ok, file_path = await src.download(cand, dest_dir)
            if not ok:
                _log_step(pipeline_log, "download_attempt", "warn",
                          f"{cand.source} returned ok=False", {"source": cand.source})
                continue

            # Prowlarr: persist qb_hash
            if cand.source == "prowlarr":
                qb_hash = (cand.download_ref or {}).get("qb_hash")
                if qb_hash:
                    async with _db() as db:
                        job = await db.get(DownloadJob, job_id)
                        if job:
                            job.qb_hash = qb_hash

            # Cover art: fetch and embed if missing, before reading tags
            if not cand.has_cover_art and file_path:
                try:
                    embedded = await _fetch_and_embed_cover(
                        file_path, ctx.artist, ctx.title, cand.album, mb_release_id
                    )
                    if embedded:
                        cand.has_cover_art = True
                        _log_step(pipeline_log, "cover_embedded", "ok",
                                  f"Cover art fetched and embedded for {cand.source}",
                                  {"source": cand.source})
                    else:
                        _log_step(pipeline_log, "cover_embedded", "warn",
                                  f"No cover art found for {cand.source} — CAA and Last.fm returned nothing",
                                  {"source": cand.source})
                except Exception as e:
                    _log_step(pipeline_log, "cover_embedded", "error",
                              f"Cover embed error: {e}", {"source": cand.source})

            # Read actual file tags
            tags = await _read_file_tags(file_path) if file_path else {}
            if tags:
                cand.metadata.update(tags)
                if tags.get("has_cover_art"):
                    cand.has_cover_art = True

            # Full rescore with real tags
            final_score = score_candidate(cand, mb_recording or None)
            _log_step(pipeline_log, "rescore", "ok",
                      f"Rescored {cand.source}: {final_score.total:.1f}/100",
                      {"scores": final_score.to_dict(), "tags_found": bool(tags)})

            # AcoustID fingerprint fallback: if identity weak, verify via audio fingerprint
            if final_score.identity < 15 and settings.ACOUSTID_API_KEY and file_path:
                from .fingerprint_svc import identify_recording as _acoustid_identify
                confirmed, fp_confidence = await _acoustid_identify(
                    file_path, ctx.mb_recording_id, settings.ACOUSTID_API_KEY
                )
                if confirmed:
                    final_score = ScoreBreakdown(
                        identity=35.0,
                        quality=final_score.quality,
                        source=final_score.source,
                        metadata=final_score.metadata,
                        cover_art=final_score.cover_art,
                    )
                    _log_step(pipeline_log, "acoustid_confirmed", "ok",
                              f"AcoustID confirmed recording (confidence={fp_confidence:.2f})",
                              {"fp_confidence": fp_confidence, "mb_id": ctx.mb_recording_id})
                else:
                    _log_step(pipeline_log, "acoustid_checked", "warn",
                              f"AcoustID: no match for expected recording (best={fp_confidence:.2f})",
                              {"fp_confidence": fp_confidence})

            # Identity gate
            acceptable, reason = is_acceptable(final_score)
            if not acceptable:
                _log_step(pipeline_log, "candidate_rejected", "warn",
                          f"Rejected {cand.source}: {reason} — trying next candidate",
                          {"source": cand.source, "reason": reason, "scores": final_score.to_dict()})
                log.info("pipeline: rejected %s for %s - %s: %s",
                         cand.source, ctx.artist, ctx.title, reason)
                if file_path and os.path.exists(file_path):
                    try:
                        # Don't delete if another completed job owns this file path
                        async with _db() as check_db:
                            owned = await check_db.execute(
                                select(DownloadJob.id).where(
                                    DownloadJob.file_path == file_path,
                                    DownloadJob.status == "completed",
                                )
                            )
                        if owned.scalar():
                            log.warning("pipeline: rejected file %s owned by another job — skipping deletion", file_path)
                        else:
                            os.remove(file_path)
                    except OSError as e:
                        log.warning("pipeline: could not delete rejected file %s: %s", file_path, e)
                continue

            # Accepted — write MB metadata into file tags
            downloaded_path = file_path
            winner_breakdown = final_score
            winner_candidate = cand
            # Always write at least job artist/title; MB data overrides if available
            fallback_rec = {
                "title": mb_recording.get("title") or ctx.title,
                "artist_name": mb_recording.get("artist_name") or ctx.artist,
                "release_title": mb_recording.get("release_title"),
                "isrc": mb_recording.get("isrc"),
                "recording_id": mb_recording.get("recording_id"),
            }
            wrote = await _write_mb_tags(downloaded_path, fallback_rec)
            _log_step(pipeline_log, "mb_tags_written", "ok" if wrote else "warn",
                      "metadata written to file" if wrote else "tag write skipped or failed",
                      {"wrote": wrote, "had_mb": bool(mb_recording)})
            _log_step(pipeline_log, "downloaded", "ok",
                      f"Accepted download via {cand.source} (score={final_score.total:.1f})",
                      {"file_path": downloaded_path, "source": cand.source, "scores": final_score.to_dict()})
            break

        except Exception as e:
            err = str(e)
            _log_step(pipeline_log, "download_attempt", "error",
                      f"{cand.source} download failed: {err}",
                      {"source": cand.source, "error": err})
            log.warning("pipeline: download failed via %s for %s - %s: %s",
                        cand.source, ctx.artist, ctx.title, err)
            if file_path and os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except OSError:
                    pass

    if winner_candidate is None:
        _log_step(pipeline_log, "download_failed", "error",
                  f"All {min(_MAX_DOWNLOAD_ATTEMPTS, len(scored))} candidates failed quality gate or download")
        await _handle_failure(job_id, "All download attempts failed", pipeline_log)
        return

    # ── Prowlarr: torrent queued in qBit — leave as "downloading", poller handles completion ──
    if winner_candidate.source == "prowlarr":
        qb_hash = (winner_candidate.download_ref or {}).get("qb_hash")
        _log_step(pipeline_log, "queued_qb", "ok",
                  f"Prowlarr: torrent queued in qBittorrent (hash={str(qb_hash or '')[:8]}), awaiting download",
                  {"qb_hash": qb_hash})
        async with _db() as db:
            job = await db.get(DownloadJob, job_id)
            if job:
                job.pipeline_log = pipeline_log
                job.candidates = candidates_serialized
                job.selected_candidate = {**winner_candidate.to_dict(), "scores": winner_breakdown.to_dict()}
                job.confidence_score = winner_breakdown.total
                job.quality_score = winner_breakdown.quality
                if ctx.mb_recording_id:
                    job.mb_recording_id = ctx.mb_recording_id
                if mb_recording.get("artist_mbid"):
                    job.mb_artist_id = mb_recording["artist_mbid"]
                if mb_recording.get("release_mbid"):
                    job.mb_release_id = mb_recording["release_mbid"]
                # status stays "downloading" — poller sets "completed" + file_path when torrent finishes
        log.info("pipeline: %s - %s queued in qBittorrent (hash=%s), awaiting completion",
                 ctx.artist, ctx.title, str(qb_hash or "?")[:8])
        return

    # ── Determine review status + create notification ─────────────────────────
    r_status = review_status_for(winner_breakdown)
    notification_msg: str | None = None
    if r_status == "pending_review":
        notification_msg = (
            f"Low confidence ({winner_breakdown.total:.0f}/100) — please verify "
            f"\"{ctx.title}\" by {ctx.artist}"
        )
    elif r_status == "bad_quality":
        notification_msg = (
            f"Poor audio quality ({winner_breakdown.quality:.0f}/25 pts) — "
            f"\"{ctx.title}\" by {ctx.artist} — daily retry will attempt upgrade"
        )

    _log_step(pipeline_log, "review_status", "ok",
              f"review_status={r_status}, confidence={winner_breakdown.total:.1f}",
              {"review_status": r_status, "scores": winner_breakdown.to_dict()})

    # ── Persist final result ──────────────────────────────────────────────────
    async with _db() as db:
        job = await db.get(DownloadJob, job_id)
        if not job:
            return
        job.status = "completed"
        job.source_used = winner_candidate.source
        job.sources_tried = [{"source": c.source, "error": None} for _, c in scored]
        job.completed_at = datetime.now(timezone.utc)
        job.auto_expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)
        job.file_path = downloaded_path
        job.confidence_score = winner_breakdown.total
        job.quality_score = winner_breakdown.quality
        job.review_status = r_status
        job.selected_candidate = {
            **winner_candidate.to_dict(),
            "scores": winner_breakdown.to_dict(),
        }
        job.candidates = candidates_serialized
        job.pipeline_log = pipeline_log
        if ctx.mb_recording_id:
            job.mb_recording_id = ctx.mb_recording_id
        if mb_recording.get("artist_mbid"):
            job.mb_artist_id = mb_recording["artist_mbid"]
        if mb_recording.get("release_mbid"):
            job.mb_release_id = mb_recording["release_mbid"]

        if notification_msg:
            notif_type = "quality_check" if r_status == "pending_review" else "upgrade_ready"
            try:
                notif = UserNotification(
                    type=notif_type,
                    download_job_id=job_id,
                    message=notification_msg,
                )
                db.add(notif)
            except Exception as e:
                # Notification failure must not kill the pipeline
                _log_step(pipeline_log, "notification", "error",
                          f"Failed to create notification: {e}")
                log.exception("pipeline: notification creation failed for %s", job_id)

    log.info("pipeline: %s - %s completed via %s (confidence=%.1f, review=%s)",
             ctx.artist, ctx.title, winner_candidate.source, winner_breakdown.total, r_status)

    # ── Post-download hook (Navidrome rescan + Essentia) ──────────────────────
    if winner_candidate.source not in ("prowlarr",):
        from ..core.tasks import spawn
        spawn(_post_download_hook(job_id), name=f"post-dl-{job_id}")


async def _run_upgrade_pipeline(job_id: uuid.UUID) -> None:
    """Re-run pipeline for a bad_quality job; replace file only if better score found."""
    async with _db() as db:
        job = await db.get(DownloadJob, job_id)
        if not job or job.review_status != "bad_quality":
            return
        old_path = job.file_path
        old_score = job.confidence_score or 0.0
        ctx = types.SimpleNamespace(
            id=job.id, artist=job.artist, title=job.title,
            item_type=job.item_type,
            mb_recording_id=job.mb_recording_id,
            mb_artist_id=job.mb_artist_id,
        )

    log.info("upgrade: re-running pipeline for %s - %s (current score=%.1f)",
             ctx.artist, ctx.title, old_score)

    # Reset job status temporarily so _run_pipeline can execute
    async with _db() as db:
        job = await db.get(DownloadJob, job_id)
        if job:
            job.status = "queued"
            job.candidates = []
            job.pipeline_log = []

    # Run a full pipeline attempt
    await _run_pipeline(job_id)

    # Check if we got a better result
    async with _db() as db:
        job = await db.get(DownloadJob, job_id)
        if not job or job.status != "completed":
            return
        new_score = job.confidence_score or 0.0
        new_path = job.file_path
        if new_score > old_score + 5:
            # Delete old file
            if old_path and os.path.exists(old_path):
                try:
                    os.remove(old_path)
                    log.info("upgrade: replaced %s (score %.1f → %.1f)", old_path, old_score, new_score)
                except OSError as e:
                    log.error("upgrade: could not delete old file %s: %s", old_path, e)
                    # Continue — new file is already downloaded
        else:
            log.info("upgrade: new score %.1f not significantly better than %.1f — keeping original", new_score, old_score)
            # The re-run downloaded a new file and pointed job.file_path at it.
            # Since we're keeping the original, that new file is an orphan on
            # disk — delete it and restore the original path/score (SRC-5).
            if new_path and new_path != old_path and os.path.exists(new_path):
                try:
                    os.remove(new_path)
                    log.info("upgrade: discarded not-better new file %s", new_path)
                except OSError as e:
                    log.error("upgrade: could not delete new orphan %s: %s", new_path, e)
            job.file_path = old_path
            job.confidence_score = old_score
            job.review_status = "bad_quality"  # keep flagged for a future better source
            await db.commit()


async def _handle_failure(job_id: uuid.UUID, error_msg: str, pipeline_log: list) -> None:
    async with _db() as db:
        job = await db.get(DownloadJob, job_id)
        if not job:
            return
        job.sources_tried = job.sources_tried or []
        job.last_error = error_msg
        job.pipeline_log = pipeline_log
        job.retry_count = (job.retry_count or 0) + 1

        if job.retry_count > _MAX_RETRIES:
            job.status = "exhausted"
            job.next_retry_at = None
            log.warning("pipeline: %s - %s exhausted after %d retries",
                        job.artist, job.title, job.retry_count)
            # Notify user of permanent failure — but only once per song.
            # playlist_health resets exhausted jobs back to failed every 30 min;
            # without this dedup each re-exhaustion spawned a new notification
            # (live count hit 229 duplicates). Match an existing undismissed
            # "exhausted" notice for the same title+artist (the job_id changes
            # across retries, so we match on message text).
            try:
                needle = f'"{job.title}" by {job.artist}'
                existing = await db.execute(
                    select(UserNotification.id).where(
                        UserNotification.type == "exhausted",
                        UserNotification.dismissed == False,  # noqa: E712
                        UserNotification.message.contains(needle),
                    ).limit(1)
                )
                if existing.scalars().first() is None:
                    db.add(UserNotification(
                        type="exhausted",
                        download_job_id=job_id,
                        message=(
                            f"Could not find \"{job.title}\" by {job.artist} "
                            f"after {job.retry_count} retries across all sources."
                        ),
                    ))
            except Exception as e:
                log.exception("pipeline: exhausted notification failed: %s", e)
        else:
            delay = _BACKOFF_MINUTES[job.retry_count - 1]
            job.status = "failed"
            job.next_retry_at = datetime.now(timezone.utc) + timedelta(minutes=delay)
            log.info("pipeline: %s - %s failed (attempt %d), retry in %d min",
                     job.artist, job.title, job.retry_count, delay)


async def _persist_log(job_id: uuid.UUID, pipeline_log: list,
                       mb_recording_id: str | None = None,
                       mb_artist_id: str | None = None,
                       mb_release_id: str | None = None) -> None:
    try:
        async with _db() as db:
            job = await db.get(DownloadJob, job_id)
            if job:
                job.pipeline_log = list(pipeline_log)
                if mb_recording_id:
                    job.mb_recording_id = mb_recording_id
                if mb_artist_id:
                    job.mb_artist_id = mb_artist_id
                if mb_release_id:
                    job.mb_release_id = mb_release_id
    except Exception as e:
        log.exception("pipeline: failed to persist log for %s: %s", job_id, e)


async def _persist_candidates(job_id: uuid.UUID, pipeline_log: list,
                               candidates: list[dict]) -> None:
    try:
        async with _db() as db:
            job = await db.get(DownloadJob, job_id)
            if job:
                job.pipeline_log = list(pipeline_log)
                job.candidates = candidates
    except Exception as e:
        log.exception("pipeline: failed to persist candidates for %s: %s", job_id, e)


async def _post_download_hook(job_id: uuid.UUID) -> None:
    try:
        from .navidrome import trigger_scan
        from .essentia_svc import analyse_pending_songs
        from ..jobs.library_sync import run_library_sync
        from ..models.library import Song
        from .musicbrainz import get_recording
        await trigger_scan()
        # Give Navidrome time to finish indexing before we pull from it
        await asyncio.sleep(10)
        await run_library_sync()
        await analyse_pending_songs()

        async with _db() as db:
            from ..core.config import get_settings as _get_settings
            music_dir = _get_settings().MUSIC_DIR
            job = await db.get(DownloadJob, job_id)
            if not job or not job.file_path:
                return

            # Songs.file_path is Navidrome-relative; DownloadJob.file_path is absolute.
            # Navidrome uses tag-based virtual paths (Artist/Album/file) which differ from
            # the flat filename we saved — so we need multi-fallback lookup.
            # Eager-load .album on every lookup — the cover-embed path below
            # reads song.album.title, and a lazy load on the async session
            # raises MissingGreenlet (silently swallowed → cover never embeds).
            from sqlalchemy.orm import selectinload as _selectinload
            rel_path = job.file_path
            if rel_path.startswith(music_dir + "/"):
                rel_path = rel_path[len(music_dir) + 1:]
            song_q = await db.execute(
                select(Song).options(_selectinload(Song.album)).where(Song.file_path == rel_path)
            )
            song = song_q.scalar_one_or_none()

            # Fallback 1: match by MB recording ID (most reliable when available)
            if song is None and job.mb_recording_id:
                song_q = await db.execute(
                    select(Song).options(_selectinload(Song.album))
                    .where(Song.mb_recording_id == job.mb_recording_id)
                )
                song = song_q.scalar_one_or_none()

            # Fallback 2: title+artist exact match on songs added in last 10 min
            if song is None and job.title and job.artist:
                from datetime import timedelta
                from sqlalchemy import func as _func
                cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
                song_q = await db.execute(
                    select(Song).options(_selectinload(Song.album)).where(
                        _func.lower(Song.title) == job.title.lower(),
                        Song.display_artist.ilike(job.artist),
                        Song.added_at >= cutoff,
                    ).order_by(Song.added_at.desc()).limit(1)
                )
                song = song_q.scalar_one_or_none()
                if song:
                    log.info("post-download hook: found song via title+artist fallback for '%s - %s'", job.artist, job.title)

            # Mark cover art status; if missing, try immediately rather than waiting for scheduled job
            if song:
                has_cover = bool(job.selected_candidate and job.selected_candidate.get("has_cover_art"))
                if not has_cover and job.file_path and os.path.exists(job.file_path):
                    try:
                        artist_name = song.display_artist or job.artist or ""
                        album_name = song.album.title if song.album else None
                        ok = await _fetch_and_embed_cover(
                            job.file_path, artist_name, song.title, album_name,
                            None, job.mb_recording_id or None,
                        )
                        if ok:
                            has_cover = True
                            log.info("post-download hook: embedded cover for '%s - %s'", artist_name, song.title)
                    except Exception as e:
                        log.debug("post-download hook: cover fetch failed for '%s': %s", song.title, e)
                song.has_cover = has_cover
                song.cover_last_tried_at = datetime.now(timezone.utc)
                song.cover_fetch_attempts = 0 if has_cover else 1

            # Write MB-sourced romanized title if available
            if song and job.mb_recording_id:
                try:
                    mb_rec = await get_recording(job.mb_recording_id)
                    rom = mb_rec.get("title_romanized")
                    if rom:
                        song.title_romanized = rom
                        log.info("Set title_romanized=%r for '%s' from MB aliases", rom, song.title)
                except Exception as e:
                    log.warning("post-download hook: MB romanized lookup failed: %s", e)

            # Stage songs downloaded for daily playlists — hidden in library until playlist processed.
            # Also write the song's UUID back into the DailyPlaylist JSONB so EOD can identify it.
            if song and job.playlist_id and not song.profile_id:
                song.is_staged = True
                try:
                    from ..models.discovery import DailyPlaylist as _DP
                    from sqlalchemy.orm.attributes import flag_modified as _fm_dp
                    pl_obj = await db.get(_DP, job.playlist_id)
                    if pl_obj and pl_obj.songs:
                        songs_list = list(pl_obj.songs)
                        job_artist = (job.artist or "").lower()
                        job_title = (job.title or "").lower()
                        for entry in songs_list:
                            if entry.get("id") or entry.get("_genre") or entry.get("_artist_of_day"):
                                continue
                            ea = (entry.get("artist") or "").lower()
                            et = (entry.get("title") or "").lower()
                            if ea == job_artist and et == job_title:
                                entry["id"] = str(song.id)
                                entry["navidrome_id"] = song.navidrome_id or ""
                                pl_obj.songs = songs_list
                                _fm_dp(pl_obj, "songs")
                                break
                except Exception as _e:
                    log.warning("post-download hook: DailyPlaylist JSONB update failed: %s", _e)

            # Assign to profile
            if song and job.profile_id:
                song.profile_id = job.profile_id
                song.needs_profile_assignment = False
                song.is_staged = False

            # Auto-add to UserPlaylist when job was created with a user_playlist_id
            if song and job.user_playlist_id:
                from ..models.playlists import UserPlaylist as _UPL
                from sqlalchemy.orm.attributes import flag_modified as _fm
                upl = await db.get(_UPL, job.user_playlist_id)
                if upl is not None:
                    songs_list = list(upl.songs or [])
                    if str(song.id) not in {s.get("id") for s in songs_list}:
                        artist_name = song.display_artist or job.artist
                        songs_list.append({
                            "id": str(song.id),
                            "navidrome_id": song.navidrome_id or "",
                            "title": song.title,
                            "artist": artist_name,
                            "duration_sec": song.duration_sec or 0,
                        })
                        upl.songs = songs_list
                        _fm(upl, "songs")
                        log.info("playlist '%s': added '%s - %s'", upl.name, artist_name, song.title)
    except Exception:
        log.exception("post-download hook failed for job %s", job_id)
