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
from .scoring import ScoreBreakdown, score_candidate, review_status_for
from .sources.base import Candidate
from .sources import prowlarr_src, soulseek_src, youtube_src, archive_org_src

log = logging.getLogger(__name__)

_BACKOFF_MINUTES = [15, 30, 60, 120, 240, 480, 720, 1440, 2880]
_MAX_RETRIES = len(_BACKOFF_MINUTES)
_SOURCE_SEARCH_TIMEOUT = 50   # seconds per source before we give up waiting
_MAX_DOWNLOAD_ATTEMPTS = 3    # try top-N candidates before giving up


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


async def request_download(
    db: AsyncSession,
    item_type: str,
    artist: str,
    title: str = "",
    playlist_id: Optional[uuid.UUID] = None,
    mb_recording_id: Optional[str] = None,
    mb_artist_id: Optional[str] = None,
) -> DownloadJob:
    """Create a DownloadJob and kick off the parallel pipeline immediately."""
    job = DownloadJob(
        item_type=item_type,
        artist=artist,
        title=title,
        status="queued",
        sources_tried=[],
        retry_count=0,
        playlist_id=playlist_id,
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
    asyncio.create_task(_run_pipeline(job_id))
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
    asyncio.create_task(_run_pipeline(job_id))


async def _run_pipeline(job_id: uuid.UUID) -> None:
    """Parallel source search → score all candidates → download winner."""
    pipeline_log: list[dict] = []

    # ── Load job ─────────────────────────────────────────────────────────────
    async with _db() as db:
        job = await db.get(DownloadJob, job_id)
        if not job or job.status not in ("queued",):
            return
        job.status = "downloading"
        ctx = types.SimpleNamespace(
            id=job.id,
            artist=job.artist,
            title=job.title,
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
        try:
            results = await asyncio.wait_for(src.search(ctx), timeout=_SOURCE_SEARCH_TIMEOUT)
            source_log[src.NAME] = f"{len(results)} candidates"
            return results
        except asyncio.TimeoutError:
            err = f"search timed out after {_SOURCE_SEARCH_TIMEOUT}s"
            source_log[src.NAME] = f"timeout: {err}"
            log.warning("pipeline: %s timed out for %s - %s", src.NAME, ctx.artist, ctx.title)
            return []
        except Exception as e:
            err = str(e)
            source_log[src.NAME] = f"error: {err}"
            log.warning("pipeline: %s search failed for %s - %s: %s", src.NAME, ctx.artist, ctx.title, err)
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

    # ── Score all candidates ──────────────────────────────────────────────────
    scored: list[tuple[ScoreBreakdown, Candidate]] = []
    for cand in all_candidates:
        try:
            breakdown = score_candidate(cand, mb_recording or None)
            scored.append((breakdown, cand))
        except Exception as e:
            log.warning("pipeline: scoring failed for candidate %s/%s: %s", cand.source, cand.title, e)

    scored.sort(key=lambda x: x[0].total, reverse=True)

    candidates_serialized = [
        {**c.to_dict(), "scores": b.to_dict()}
        for b, c in scored
    ]
    _log_step(pipeline_log, "candidates_scored", "ok",
              f"Scored {len(scored)} candidates; best={scored[0][0].total:.1f} from {scored[0][1].source}",
              {"top_candidates": candidates_serialized[:10]})
    await _persist_candidates(job_id, pipeline_log, candidates_serialized)

    # ── Download winner (try top-N) ───────────────────────────────────────────
    from ..core.config import get_settings
    settings = get_settings()
    dest_dir = settings.MUSIC_DIR

    downloaded_path: str | None = None
    winner_breakdown: ScoreBreakdown | None = None
    winner_candidate: Candidate | None = None

    source_map = {s.NAME: s for s in sources}

    for breakdown, cand in scored[:_MAX_DOWNLOAD_ATTEMPTS]:
        src = source_map.get(cand.source)
        if not src:
            continue
        try:
            _log_step(pipeline_log, "download_attempt", "ok",
                      f"Attempting download via {cand.source} (score={breakdown.total:.1f})",
                      {"source": cand.source, "format": cand.format, "bitrate": cand.bitrate})
            ok, file_path = await src.download(cand, dest_dir)
            if ok:
                downloaded_path = file_path
                winner_breakdown = breakdown
                winner_candidate = cand
                # Prowlarr: persist qb_hash from download_ref
                if cand.source == "prowlarr":
                    qb_hash = (cand.download_ref or {}).get("qb_hash")
                    if qb_hash:
                        async with _db() as db:
                            job = await db.get(DownloadJob, job_id)
                            if job:
                                job.qb_hash = qb_hash
                _log_step(pipeline_log, "downloaded", "ok",
                          f"Downloaded via {cand.source}",
                          {"file_path": downloaded_path, "source": cand.source})
                break
        except Exception as e:
            err = str(e)
            _log_step(pipeline_log, "download_attempt", "error",
                      f"{cand.source} download failed: {err}",
                      {"source": cand.source, "error": err})
            log.warning("pipeline: download failed via %s for %s - %s: %s",
                        cand.source, ctx.artist, ctx.title, err)

    if winner_candidate is None:
        _log_step(pipeline_log, "download_failed", "error",
                  f"All {min(_MAX_DOWNLOAD_ATTEMPTS, len(scored))} download attempts failed")
        await _handle_failure(job_id, "All download attempts failed", pipeline_log)
        return

    # ── Post-download: re-score with actual file tags ─────────────────────────
    if downloaded_path:
        tags = await _read_file_tags(downloaded_path)
        if tags:
            winner_candidate.metadata.update(tags)
            if tags.get("has_cover_art"):
                winner_candidate.has_cover_art = True
            try:
                winner_breakdown = score_candidate(winner_candidate, mb_recording or None)
                _log_step(pipeline_log, "rescore", "ok",
                          f"Rescored after tag read: {winner_breakdown.total:.1f}",
                          {"tags": tags, "scores": winner_breakdown.to_dict()})
            except Exception as e:
                _log_step(pipeline_log, "rescore", "error", f"Rescore failed: {e}")
        else:
            _log_step(pipeline_log, "rescore", "warn",
                      "No tags readable from file — using pre-download scores")

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
        asyncio.create_task(_post_download_hook(job_id))


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
            # Notify user of permanent failure
            try:
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
        await trigger_scan()
        # Give Navidrome a moment to finish indexing before we pull from it
        await asyncio.sleep(5)
        await run_library_sync()
        await analyse_pending_songs()
    except Exception:
        log.exception("post-download hook failed for job %s", job_id)
