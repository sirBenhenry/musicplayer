"""Nightly cron job — runs discovery pipeline at 02:00."""
import logging

from .eod import run_eod_batch
from ..discovery.pipeline import run_discovery

log = logging.getLogger(__name__)


async def run_nightly() -> None:
    log.info("Nightly job starting")
    try:
        await run_eod_batch()
    except Exception as e:
        log.error("EOD batch failed in nightly job: %s", e)
    try:
        await run_discovery()
    except Exception as e:
        log.error("Discovery pipeline failed in nightly job: %s", e)
    log.info("Nightly job complete")
