"""AcoustID audio fingerprinting — identity fallback for string-match failures.

Used when fuzzy title matching fails (e.g. Japanese kanji vs romanized title)
and romanization still leaves identity score below the acceptance threshold.
"""
import asyncio
import json
import logging

import httpx

log = logging.getLogger(__name__)
_ACOUSTID_URL = "https://api.acoustid.org/v2/lookup"


async def fingerprint_file(file_path: str) -> dict | None:
    """Run fpcalc, return {duration: int, fingerprint: str} or None on failure."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "fpcalc", "-json", file_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        if proc.returncode != 0:
            log.warning("fpcalc failed (rc=%d): %s", proc.returncode, stderr.decode().strip())
            return None
        return json.loads(stdout.decode())
    except asyncio.TimeoutError:
        log.warning("fpcalc timed out for %s", file_path)
        return None
    except Exception as e:
        log.warning("fingerprint_file failed for %s: %s", file_path, e)
        return None


async def acoustid_lookup(fingerprint: str, duration: int, api_key: str) -> list[dict]:
    """POST to AcoustID API. Returns list of {score: float, recording_ids: list[str]}, best first."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(_ACOUSTID_URL, data={
                "client": api_key,
                "duration": str(int(duration)),
                "fingerprint": fingerprint,
                "meta": "recordings",
            })
            r.raise_for_status()
            data = r.json()

        if data.get("status") != "ok":
            log.warning("AcoustID returned status=%s", data.get("status"))
            return []

        results = []
        for result in data.get("results", []):
            score = float(result.get("score", 0))
            ids = [rec["id"] for rec in result.get("recordings", []) if rec.get("id")]
            if ids:
                results.append({"score": score, "recording_ids": ids})
        return sorted(results, key=lambda x: x["score"], reverse=True)
    except Exception as e:
        log.warning("acoustid_lookup failed: %s", e)
        return []


async def identify_recording(
    file_path: str,
    expected_mb_id: str | None,
    api_key: str,
) -> tuple[bool, float]:
    """
    Fingerprint file + AcoustID lookup.

    Returns (confirmed, confidence):
      confirmed=True  → expected_mb_id found in results with score > 0.5
      confirmed=False → no match or expected_mb_id not in results
      confidence      → best AcoustID score (0.0 if fingerprint failed)
    """
    fp = await fingerprint_file(file_path)
    if not fp:
        return False, 0.0

    results = await acoustid_lookup(fp["fingerprint"], fp["duration"], api_key)
    if not results:
        return False, 0.0

    best_score = results[0]["score"]

    if expected_mb_id:
        for r in results:
            if expected_mb_id in r["recording_ids"] and r["score"] > 0.5:
                return True, r["score"]
        return False, best_score

    return False, best_score
