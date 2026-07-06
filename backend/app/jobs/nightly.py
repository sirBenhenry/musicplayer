"""Nightly cron job — runs discovery pipeline at 02:00."""
import asyncio
import logging

from .eod import run_eod_batch
from ..discovery.pipeline import run_discovery

log = logging.getLogger(__name__)

# Hard ceilings so a hung await (dead DB connection, stuck HTTP call) can never
# wedge the job forever — with max_instances=1 a wedged run silently cancels
# every following night (observed 2026-07-01..03).
_EOD_TIMEOUT = 30 * 60        # seconds
_DISCOVERY_TIMEOUT = 3 * 3600  # seconds — LLM + MB-rate-limited queuing is slow


async def run_nightly() -> None:
    log.info("Nightly job starting")
    try:
        # DSC-5: deliberate second EOD pass. The scheduler runs run_eod_batch at
        # 23:45; this 02:00 run is a catch-up for playlists that crossed the
        # threshold late or were missed. The batch is idempotent (consumed flags
        # + already-processed events), so re-running is safe.
        await asyncio.wait_for(run_eod_batch(), timeout=_EOD_TIMEOUT)
    except asyncio.TimeoutError:
        log.error("EOD batch timed out after %ds in nightly job", _EOD_TIMEOUT)
    except Exception as e:
        log.error("EOD batch failed in nightly job: %s", e)
    try:
        await asyncio.wait_for(run_discovery(), timeout=_DISCOVERY_TIMEOUT)
    except asyncio.TimeoutError:
        log.error("Discovery pipeline timed out after %ds in nightly job", _DISCOVERY_TIMEOUT)
    except Exception as e:
        log.error("Discovery pipeline failed in nightly job: %s", e)
    log.info("Nightly job complete")
