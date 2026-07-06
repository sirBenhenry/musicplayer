# Task 1 Findings — Backend Diagnosis (2026-07-05)

## A. FATAL: broken `flag_modified` import (6 call sites) — root cause of "daily playlists don't work"

`from sqlalchemy.orm import flag_modified` raises `ImportError` — the function lives in
`sqlalchemy.orm.attributes`. Proven live in container log:

```
WARNING app.services.download_pipeline: post-download hook: DailyPlaylist JSONB update failed:
cannot import name 'flag_modified' from 'sqlalchemy.orm'
```

Broken sites (only `mcp_server.py` imports it correctly):

| File | Line | Broken consequence |
|------|------|--------------------|
| `services/download_pipeline.py` | 1128 | Song UUID never written into `DailyPlaylist.songs` JSONB after download |
| `services/download_pipeline.py` | 1157 | Completed songs never auto-added to UserPlaylists (Spotify imports stay empty) |
| `jobs/download_poller.py` | 330, 383 | Same two write-backs broken on prowlarr/torrent path |
| `jobs/eod.py` | 137 | close/broader EOD processing crashes at import |
| `discovery/pipeline.py` | 190 | `refill_playlist` crashes at import |
| `jobs/playlist_health.py` | 159 | 06:00 unresolvable-song cleanup crashes |

Cascade: every playlist JSONB entry lacks `id` (verified: `with_id = 0` on ALL playlists) →
EOD's `known_songs` filter finds nothing → **no playlist ever processed, no song ever assigned,
nothing ever consumed** → 429 songs stuck `is_staged=True` (invisible), playlists accumulate
unconsumed forever (52/day since ≥6/15, consumed=0 across the board).

## B. Downloads stuck in `queued` forever

- `request_download()` line 475: `asyncio.create_task(_run_pipeline(job_id))` fire-and-forget,
  no reference kept → tasks can be GC'd / lost; nothing at runtime rescues `queued` jobs
  (startup lifespan reset only fires on container restart; retry job only handles `failed`).
- Result: 55 jobs stuck `queued` since 2026-06-30 00:22–00:27 UTC.

## C. Nightly generation gap 7/1–7/3 (the "don't generate when they should")

- Nightly ran 6/29, 6/30 normally; last queued job 6/30 00:27 UTC, then NOTHING for 3 days;
  resumed 7/4 00:01 UTC.
- Backend was NOT restarted in that window (up since 6/28). Postgres restarted ~7/3 evening —
  matches the recovery moment exactly.
- Best-fit explanation: nightly hung mid `queue_downloads` on a dead/blocked DB connection;
  APScheduler `max_instances=1` silently skipped 7/1–7/3 runs; postgres restart killed the hung
  connection and unblocked it.
- Contributing: no `pool_pre_ping`/keepalive/statement timeouts on DB engine, no overall timeout
  on the nightly job, restart on 6/28 killed generation mid-run (24/52 playlists, no resume).

## D. Unbounded generation (the "generate when they shouldn't")

`generate_for_profile` only skips slots with an unconsumed playlist dated **today**.
Yesterday's untouched playlists don't block anything. Combined with A (consumed never set):

- 52 new playlists every night (13 profiles × 4 slots) whether or not anything was listened to
- ~470 track suggestions/night → ~200 real downloads/day filling the NAS
- Hundreds of unconsumed playlists accumulate; `retry_playlist_songs` (every 30 min) and EOD
  scan ALL of them — thousands of pointless DB queries per run, and 30-min job re-queues
  downloads for weeks-old zombie playlists.
- `__temp__` junk profile has `daily_auto_generate=True` — generates 4 playlists + downloads nightly.

## E. Library sync self-deadlock + log flooding

- 228 artists deleted from Navidrome still in DB → hourly sync gets `code 70: Artist not found`
  228× → `fetch_failures > 0` → stale cleanup **permanently skipped** (the cleanup that would
  remove those very artists). 1941 such warnings in the current log window alone.
- Hourly sync's per-artist/per-album HTTP spam rotates the entire 20MB log in hours — all
  useful history (nightly runs, EOD results, errors) is lost. Made this diagnosis mostly blind.

## F. Content quality — library polluted

- LLM (deepseek) hallucinated songs get queued and downloaded from fuzzy sources
  (e.g. "Vox Freaks — Blowing on a Ketchup Bottle (Extended Mix)", "The Elevator That Only
  Plays Muzak Backwards"). Pipeline downloads the nearest YouTube/soulseek match.
- 7100 songs in DB; only 566 profile-assigned, 429 staged, rest unassigned (catchall) —
  large fraction is discovery-downloaded junk mixed with wanted music.
- USER DECISION: full song wipe for a clean start is acceptable.

## G. Minor

- Uncommitted diff in `api/playlists.py`: adds `_parse_uuid` helper, never used (half-finished).
- Prowlarr searches with Japanese queries error out (25 log entries) — sources still cover.
- 1 `downloading` job (qb torrent queued today 20:21) — poller/stale-reset path looks functional.
- Download pipeline itself WORKS: ~200 completions/day, dedup works, failures are edge cases
  (quality gate on obscure Japanese tracks).

## Fix plan (Task 2 — waiting for go)

1. Fix all 6 `flag_modified` imports (one-line each) — restores staging → EOD → assignment loop.
2. Downloads: keep strong task refs + periodic stale-`queued` rescue job.
3. DB resilience: `pool_pre_ping=True`, connect/statement timeouts, keepalives.
4. Scheduler: `misfire_grace_time`, `coalesce`, explicit `max_instances` + hard timeout on nightly.
5. Generation policy: don't regenerate a slot while an unconsumed playlist for that slot exists
   (any date) — or expire old playlists first; cap scans to recent dates; kill `__temp__` profile.
6. Library sync: treat `code 70` as gone (delete or mark), not transient; quiet the HTTP log spam
   (or raise rotation size) so history survives.
7. Clean start: wipe songs (DB + files) per user approval — exact scope to confirm
   (downloaded-only vs. also original library), plus purge zombie playlists, staged songs,
   stuck jobs, stale artists.
8. Redeploy via Portainer patch-upload + restart; verify with manual `/admin/generate` +
   forced EOD run.
