from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

scheduler = AsyncIOScheduler()


def start_scheduler(settings) -> None:
    from ..jobs.library_sync import run_library_sync
    from ..jobs.nightly import run_nightly as run_nightly_discovery
    from ..jobs.eod import run_eod_batch

    # Parse "0 2 * * *" → minute=0, hour=2
    def _cron(expr: str) -> CronTrigger:
        parts = expr.split()
        return CronTrigger(
            minute=parts[0], hour=parts[1],
            day=parts[2], month=parts[3], day_of_week=parts[4],
            timezone=settings.TZ,
        )

    scheduler.add_job(run_library_sync, _cron(settings.LIBRARY_SYNC_CRON), id="library_sync")
    scheduler.add_job(run_nightly_discovery, _cron(settings.DAILY_GENERATION_CRON), id="nightly_discovery")
    scheduler.add_job(run_eod_batch, _cron(settings.EOD_CRON), id="eod_batch")

    # Poll qBittorrent every 2 min for completed music downloads
    from ..jobs.download_poller import poll_completed_downloads
    scheduler.add_job(poll_completed_downloads, "interval", minutes=2, id="dl_poller")

    # Retry failed downloads every 15 min
    from ..jobs.download_retry import retry_failed_downloads, upgrade_bad_quality_downloads
    scheduler.add_job(retry_failed_downloads, "interval", minutes=15, id="dl_retry")

    # Daily quality upgrade at 03:00
    scheduler.add_job(upgrade_bad_quality_downloads, _cron("0 3 * * *"), id="quality_upgrade")

    # Analyse pending songs every 5 min (batch of 50). Subprocess per song = crash-safe.
    from ..services.essentia_svc import analyse_pending_songs
    scheduler.add_job(analyse_pending_songs, "interval", minutes=5, id="essentia_analysis",
                      kwargs={"limit": 50})

    scheduler.start()


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
