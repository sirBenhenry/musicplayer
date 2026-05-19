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

    scheduler.start()


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
