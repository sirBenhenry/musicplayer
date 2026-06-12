# FIXPLAN.md — Full-App Audit & Repair Plan

**Generated:** 2026-06-12, by a full read of every backend + mobile source file, plus live probing
of the running system at `10.1.8.4`.

**How to use this document (instructions for the implementing model):**

- Work through phases in order. Items within a phase are ordered by dependency, then severity.
- Every item has an ID (`OPS-x`, `BE-x`, `MOB-x`, `DSC-x`, `SRC-x`, `CLN-x`). Reference the ID in commit messages.
- Each item states: the problem, why it matters, the **exact** fix, and how to verify.
- File paths are relative to repo root. Line numbers are as of this audit — re-locate by the quoted code if lines shifted.
- **Backend deploys**: use the Portainer patch-upload workflow in `CLAUDE.md` (tar → PUT archive → restart container `f05355dcf876`). After ANY backend change, also commit to git — see OPS-2 for why drift is dangerous.
- **Mobile**: test via `npx expo start` against the live backend; release via `./gradlew assembleRelease` + GitHub Release (see `CLAUDE.md`, mandatory version bump).
- Do **not** invent behavior not specified here. If something is ambiguous, the item says so and states the chosen resolution.

---

## Live-system findings (state as of 2026-06-12, already partially remediated)

These were discovered by probing the running system and explain why "everything felt broken":

1. **Host root disk was 100% full (38 GB)** → `musicapp-postgres` was crash-looping for at least a day
   (`FATAL: could not write lock file "postmaster.pid": No space left on device`) → **every** DB-backed
   API endpoint returned 500. The app was effectively dead.
   **Root cause:** 7.6 GB of orphaned `tmp*.flac/.m4a` files in `/tmp` *inside the music-backend
   container* (= host overlay disk), leaked by the Essentia analysis pipeline, plus ~6 GB of dead
   one-off containers and dangling images.
   **Already done in this session:** deleted the temp files, removed 7 old exited containers, pruned
   dangling images (~8.5 GB freed, disk now ~78%). **Prevention is OPS-3 / OPS-4 below — still TODO.**

2. **The deployed backend code is OLDER than the repo.** Six files differ. The container is missing:
   the `/songs/stamp` endpoint (mobile polls it every 15 s → got 422 → treated as stale → **refetched
   the entire 5000-song library every 15 seconds**), the `is_staged` filter (staged discovery songs
   visible in library), the `defer(feature_vector)` + `selectinload` query optimizations (the documented
   1254-roundtrip / 3 MB-per-request problem is what is actually running), the new auto-radio scoring
   (vibe features, BPM/mode SQL filters), `mb_recording_id` sync in library_sync, and the vibe-feature
   extraction in essentia_svc. Fixing the repo without redeploying fixes nothing. **→ OPS-2.**

3. **The container holds one never-committed hotfix:** `app/discovery/new_genre.py` in the container
   passes an Anthropic-format `web_search` tool to the LLM. The configured provider is DeepSeek, which
   rejects it → the New Genre generator throws → **the genre slot has been generating zero playlists**
   (live check: 2026-06-10 has close/broader/artist playlists for 13 profiles, zero genre playlists).
   **Decision (confirmed with Ben):** drop the hotfix on redeploy; re-add web search later, properly
   gated to the Claude provider only (DSC-6, optional).

4. **271 open notifications** (229 `exhausted`, 42 `quality_check`) — notification spam, see BE-10.

5. **123 download jobs stuck `queued`**, 4 `downloading`; top historical errors: 274 × "interrupted by
   container restart", 60 × "All download attempts failed", 34 × "prowlarr torrent stalled".

6. **NFS mount mismatch:** `infra/docker-compose.yml` declares the music volume as
   `:/volume2/streaming/musicapp`, but the live mount is `:/volume2/aniapp` (the pending NAS migration,
   `infra/MIGRATION_STREAMING.md`). Not a code bug — but do NOT run `docker compose up` to "fix" the
   stack until the migration is consciously executed, or the app will point at an empty share. OPS-2's
   redeploy must therefore use the **patch-upload** method, not compose recreation.

7. Leftover junk profiles in DB: `__temp__` (0 songs), `White Girl` (0 songs), `Elektro` (0 songs),
   `Nightcore` (2 songs). Ask Ben before deleting; the `__temp__` one is clearly script debris (CLN-7).

---

## Phase 0 — OPS: make the deployed system match the repo and stop it dying again

### OPS-1 ✅ (done) Disk full / Postgres crash-loop
Done in this session. Kept here for the record. If endpoints 500 again, check
`docker ps` state of `musicapp-postgres` and host disk first.

### OPS-2 — Redeploy the backend from the repo (CRITICAL, do first, blocks many items)
**Problem:** container code ≠ repo code (6 files, repo is newer in 5, container-only hotfix in 1).
**Fix, in this order:**
1. First apply the *repo-side* fixes in Phase 1 that are crash-level: **BE-1** (artists 500) and
   **BE-2** (EOD artist TypeError) at minimum. Otherwise redeploying ships known crashes.
2. Upload these files via the Portainer archive workflow (each into its directory):
   - `backend/app/api/library.py` → `/app/app/api`
   - `backend/app/api/queue.py` → `/app/app/api`
   - `backend/app/discovery/artist_of_day.py` → `/app/app/discovery`
   - `backend/app/discovery/new_genre.py` → `/app/app/discovery` (this intentionally removes the
     web_search hotfix — see live finding #3)
   - `backend/app/jobs/library_sync.py` → `/app/app/jobs`
   - `backend/app/services/essentia_svc.py` → `/app/app/services`
   - plus every file changed by Phase 1 items.
3. Restart container `f05355dcf876`.
4. **Verify:** `GET /api/v1/songs/stamp` returns `{"updated_at": ...}` (not 422).
   `GET /api/v1/artists/<some-id>` returns 200 (after BE-1). `GET /api/v1/songs?limit=3` returns fast.
5. **Verify genre generation:** `POST /api/v1/admin/generate`, wait, then `GET /api/v1/discovery/today`
   should eventually include a `genre` slot playlist.
6. Commit a note in git that container and repo were re-synced on this date.

**Process rule going forward** (add to CLAUDE.md when convenient): every container patch-upload MUST
correspond to a commit. Never hand-edit files only in the container.

### OPS-3 — Stop the Essentia temp-file leak (HIGH)
**Problem:** the analysis path downloads every song to `/tmp` inside the container. Leaked files filled
the host disk (7.6 GB found). Two leak sources:
- `backend/app/services/essentia_svc.py` — the per-song download/analyse flow (and `_essentia_worker.py`
  subprocess). The temp file is deleted in normal flow, but any crash/kill between write and unlink
  leaks it. The scheduler runs this every 5 min, so leaks accumulate forever.
- `backend/app/api/queue.py::_analyse_one` (line ~565) — same pattern (`delete=False` NamedTemporaryFile,
  unlink in `finally` — survives most errors but not process kills).
**Fix (both parts):**
1. In `essentia_svc.py`, wrap every temp file in `try/finally` unlink (verify this is already true for
   each code path, including the subprocess worker writing intermediate files).
2. Add a janitor: in `backend/app/core/scheduler.py`, register an hourly job `tmp_janitor` that deletes
   `/tmp/tmp*` files with audio extensions (`.flac/.mp3/.m4a/.ogg/.opus/.wav`) and `/tmp/*.spotdl`
   older than 6 hours:
   ```python
   def cleanup_tmp() -> None:
       import os, time, glob
       cutoff = time.time() - 6 * 3600
       for pat in ("/tmp/tmp*", "/tmp/*.spotdl"):
           for p in glob.glob(pat):
               try:
                   if os.path.isfile(p) and os.path.getmtime(p) < cutoff:
                       os.remove(p)
               except OSError:
                   pass
   ```
   (Put it in a new `backend/app/jobs/janitor.py`; schedule `interval, hours=1, id="tmp_janitor"`.)
**Verify:** after a day of operation, `du -sh /tmp` in the container stays < 1 GB.

### OPS-4 — Container log rotation (MEDIUM)
**Problem:** no `logging:` options in `infra/docker-compose.yml`; json-file logs grow unbounded on the
38 GB root disk. The backend logs heavily (per-poll, per-pipeline).
**Fix:** add to every service in `infra/docker-compose.yml`:
```yaml
    logging:
      driver: json-file
      options: { max-size: "20m", max-file: "3" }
```
**Note:** this only takes effect when containers are recreated — which is blocked on the NAS migration
(live finding #6). So: commit the compose change now, apply it as part of the migration. Interim
mitigation (optional): truncate big logs manually via Portainer console.

### OPS-5 — Reduce per-request log noise (LOW)
`main.py` sets `logging.basicConfig(level=logging.INFO)` and several jobs log per-item INFO lines
(library_sync logs every removed song, download_poller every poll action). Acceptable, but combined
with OPS-4 keep an eye on it. No action required beyond OPS-4.

---

## Phase 1 — Backend correctness bugs

### BE-1 — `GET /artists/{artist_id}` always 500s (CRITICAL — breaks artist page)
**File:** `backend/app/api/library.py` lines 432–438.
**Problem:** `ArtistOut` declares `monitored: bool` (required, no default) but the `get_artist`
endpoint constructs `ArtistOut(...)` **without** `monitored` → Pydantic `ValidationError` → 500 on
every call. The mobile artist screen (`mobile/app/artist/[id].tsx`) swallows the error, so the artist
header shows no name and follow state is always wrong.
**Fix:** add `monitored=a.lidarr_id is not None` to the constructor:
```python
return ArtistOut(id=a.id, navidrome_id=a.navidrome_id, name=a.name,
                 followed=a.followed, monitored=a.lidarr_id is not None,
                 new_release=a.new_release_flagged_at is not None)
```
**Verify:** `curl /api/v1/artists/<uuid>` → 200 with `monitored` field; artist page in app shows name
and correct Add/Follow/Following state.

### BE-2 — EOD artist-slot processing crashes with TypeError (CRITICAL — artist prompts never fire)
**File:** `backend/app/jobs/eod.py` line 312.
**Problem:** dead leftover line executes `len(kept_song_ids | {…})` where `kept_song_ids` is a **list**
— `list | set` raises `TypeError` whenever an artist playlist reaches the 80% threshold with kept
songs. The exception is caught by the batch loop, counted as an error, and the playlist is silently
never processed → the “Follow/Add artist of the day?” notification has **never** been created.
**Fix:** delete line 312 entirely (the line assigning `artist_action` with the `|` expression). Keep
lines 313–315 (the comment and the correct `all_kept` computation).
**Verify:** unit-style check or: create an artist-slot playlist whose songs all have listen_through
events, run `run_eod_batch()`, confirm a `UserNotification(type="artist_prompt")` row appears.

### BE-3 — Soulseek treats failed transfers as successful downloads (HIGH — wrong/missing files)
**File:** `backend/app/services/sources/soulseek_src.py` lines 187–198.
**Problem:** slskd terminal transfer states are compound: `"Completed, Succeeded"`,
`"Completed, Cancelled"`, `"Completed, TimedOut"`, `"Completed, Errored"`, `"Completed, Rejected"`.
The code checks `if "Completed" in state` **first** and returns success for ALL of them. Failed
transfers are reported as downloaded; the pipeline then “completes” the job with a file path that
doesn’t exist (or a partial file).
**Fix:** replace the state handling:
```python
state = t.get("state", "")
if "Succeeded" in state:
    ... return True, file_path
if any(s in state for s in ("Errored", "Cancelled", "Rejected", "TimedOut", "Failed")):
    raise RuntimeError(f"Soulseek transfer failed: {state}")
```
**Verify:** grep slskd transfer API after a failed download; job must go to `failed`, not `completed`.

### BE-4 — Soulseek download path is derived, not real (HIGH — file_path wrong when slskd nests dirs)
**File:** same file, lines 192–196.
**Problem:** the code assumes the file lands flat at `dest_dir/<basename>`. slskd saves into a
subfolder named after the remote directory (`SLSKD_DOWNLOADS_DIR=/data/music/media/music`, so files
land at `/data/music/media/music/<RemoteFolderName>/<file>`). Result: `DownloadJob.file_path` points
at a non-existent flat path → tag write fails silently, cover embed fails, post-download Song matching
falls back to fuzzy paths, future dedup checks (`os.path.exists`) fail and cause re-downloads.
**Fix:** after `"Succeeded"`, resolve the actual path:
1. Preferred: ask slskd — `GET /api/v1/transfers/downloads/{username}` entries contain enough to
   reconstruct; but simplest robust approach:
2. Search for the basename under `dest_dir`, newest match wins:
```python
local_name = os.path.basename(filename.replace("\\", "/"))
candidates = []
for root, _dirs, files in os.walk(dest_dir):
    if local_name in files:
        p = os.path.join(root, local_name)
        candidates.append((os.path.getmtime(p), p))
if candidates:
    candidates.sort(reverse=True)
    return True, candidates[0][1]
return True, os.path.join(dest_dir, local_name)  # last-resort old behavior
```
(`dest_dir` is the NFS music root; the walk is acceptable at this library size, but bound it: skip
the walk if a direct `os.path.exists(flat_path)` hit succeeds first.)
**Verify:** download a soulseek candidate; `DownloadJob.file_path` must `os.path.exists()`.

### BE-5 — `GET /profiles` loads every song row (incl. 5 KB vectors) just to count (HIGH perf)
**File:** `backend/app/api/profiles.py` lines 43–47.
**Problem:** per profile it executes `select(Song).where(profile_id==...)` and `len(scalars().all())` —
loads full ORM rows including the 1280-float `feature_vector`. With 14 profiles × hundreds of songs
this is megabytes of DB traffic on an endpoint the app calls at startup.
**Fix:** one grouped count query:
```python
from sqlalchemy import func
counts_res = await db.execute(
    select(Song.profile_id, func.count(Song.id)).group_by(Song.profile_id)
)
count_map = {pid: n for pid, n in counts_res.all()}
...
song_count = count_map.get(p.id, 0)
```
**Verify:** endpoint returns same counts, response time drops.

### BE-6 — Deleting a profile with songs/playlists 500s (HIGH)
**File:** `backend/app/api/profiles.py` `delete_profile` (lines 84–92).
**Problem:** `songs.profile_id` and `daily_playlists.profile_id` FKs have no `ON DELETE`; deleting a
profile that has songs or daily playlists raises `IntegrityError` → 500. The mobile dialog explicitly
promises “songs will become unassigned”.
**Fix:** before `db.delete(p)`:
```python
from sqlalchemy import update, delete as sa_delete
from ..models.library import Song
from ..models.discovery import DailyPlaylist
from ..models.events import DownloadJob
await db.execute(update(Song).where(Song.profile_id == profile_id)
                 .values(profile_id=None, needs_profile_assignment=False))
await db.execute(update(DownloadJob).where(DownloadJob.profile_id == profile_id)
                 .values(profile_id=None))
await db.execute(sa_delete(DailyPlaylist).where(DailyPlaylist.profile_id == profile_id))
```
then delete + commit, and call `bump_library_stamp()` (import from `..api.library`) so mobile refreshes.
**Verify:** create throwaway profile, assign one song, delete profile → 204, song visible in All Music.

### BE-7 — `/queue/append` and `/queue/next` crash on lazy artist load (MEDIUM — dead endpoints)
**File:** `backend/app/api/queue.py` `_song_dict` (lines 584–599) used by `append`/`insert_next`.
**Problem:** `song.artist` triggers a lazy load on an async session → `MissingGreenlet` → 500.
Mobile doesn’t use these endpoints (it manages the queue locally in RNTP), so the in-memory `_queue`,
`append`, `insert_next`, `remove_item`, `reorder`, `get_queue` endpoints are dead weight.
**Fix (chosen):** delete the in-memory queue block entirely — `_queue`, `_current_index`, the five
endpoints, `AppendBody/NextBody/ReorderBody`, and `_song_dict`. Keep only `/queue/auto-radio` and
`/queue/auto-radio-batch`. Remove `getQueue`/`appendQueue` from `mobile/lib/api.ts` (unused).
**Verify:** app builds; auto-radio still works.

### BE-8 — On-demand single-song analysis poisons the song (MEDIUM)
**File:** `backend/app/api/queue.py` `_analyse_one` (lines 535–579).
**Problem:** it sets `analysed_at` after extracting only `feature_vector` — BPM/key/mood/vibe columns
stay NULL, and the scheduled `analyse_pending_songs` (which fills everything) skips songs with
`analysed_at IS NOT NULL`. Songs that go through this path permanently lack the fields auto-radio
scoring uses. It also duplicates Navidrome download logic with hardcoded env defaults.
**Fix:** replace the body: instead of doing its own extraction, simply leave the song un-analysed and
trigger the real path: `asyncio.create_task(analyse_pending_songs(limit=1))` after confirming the song
has `analysed_at IS NULL`… **but** `analyse_pending_songs` picks its own batch. Cleanest minimal fix:
keep the download-to-temp logic but call the same full feature extraction used by
`essentia_svc.analyse_pending_songs` for one song (factor a `analyse_one_song(song_id)` helper out of
`essentia_svc.py` and call it here), so ALL fields get written. If factoring is too invasive: change
`_analyse_one` to NOT set `analysed_at` when only the vector was extracted, accepting double work later.
**Verify:** play a never-analysed song → auto-radio works next time AND the song eventually has bpm set.

### BE-9 — library_sync deletes songs (and their profile assignments) on transient Navidrome errors (HIGH, data-loss)
**File:** `backend/app/jobs/library_sync.py` lines 84–164.
**Problem:** if `navidrome.get_artist(nav_id)` fails for an artist (timeout, restart mid-scan), that
artist’s songs are never added to `seen_song_ids`, and the stale-cleanup at the end **deletes them
from the DB**. They come back on the next successful sync as NEW rows — with `profile_id = NULL`.
Profile assignments silently evaporate. This very likely explains “songs randomly losing their profile”.
**Fix:** track failures and skip cleanup when any occurred:
```python
fetch_failures = 0
...
except Exception as e:
    log.warning("Failed to fetch artist %s: %s", nav_id, e)
    fetch_failures += 1
    continue
...  # same for album fetch failures
# --- Cleanup stale songs ---
if seen_song_ids and fetch_failures == 0:
    ...existing cleanup...
elif fetch_failures:
    log.warning("library_sync: skipping stale cleanup — %d fetch failures", fetch_failures)
```
**Verify:** stop Navidrome mid-sync; no songs are deleted.

### BE-10 — Notification spam: 229 duplicate `exhausted` notifications (HIGH UX)
**Files:** `backend/app/services/download_pipeline.py` `_handle_failure` (lines 941–974), and
`backend/app/jobs/playlist_health.py` `retry_playlist_songs` (lines 28–84).
**Problem:** `retry_playlist_songs` resets `exhausted` playlist jobs back to `failed` every 30 min;
each time they exhaust again, `_handle_failure` creates a NEW `UserNotification(type="exhausted")`.
One unfindable song → dozens of identical notifications. Live count: 229.
**Fix (three parts):**
1. In `_handle_failure`, before adding the exhausted notification, check for an existing undismissed
   one for the same song:
   ```python
   existing = await db.execute(select(UserNotification).where(
       UserNotification.type == "exhausted",
       UserNotification.dismissed == False,
       UserNotification.message.contains(f'"{job.title}"'),
   ).limit(1))
   if existing.scalars().first() is None:
       db.add(UserNotification(...))
   ```
   (Message-based matching is crude but requires no migration. Optionally add a proper
   `dedupe_key` column later.)
2. In `retry_playlist_songs`, stop resetting jobs forever: only reset an exhausted job if its
   `pipeline_log` contains fewer than 2 entries with `step == "playlist_health_reset"`; append such a
   marker entry each time it resets one. After that, leave it to the 06:00 LLM-alternative/cleanup path.
3. One-time cleanup: `POST /api/v1/notifications/dismiss-all` (or SQL `UPDATE user_notifications SET
   dismissed=true WHERE type='exhausted'`) to clear the current 229.
**Verify:** notification count stays sane after a nightly cycle with unfindable songs.

### BE-11 — Spotify import always names the playlist “Imported Playlist” (MEDIUM)
**File:** `backend/app/services/spotify_import.py` lines 57–63.
**Problem:** `spotdl save` writes a JSON **list** of songs; each song carries `list_name`. The code only
reads `name`/`list_name` when the top-level is a dict, which it never is → `playlist_name` is None.
**Fix:**
```python
if isinstance(data, list):
    songs = data
    playlist_name = (songs[0].get("list_name") if songs and isinstance(songs[0], dict) else None)
```
**Verify:** import a Spotify playlist → UserPlaylist gets the real name.

### BE-12 — Stream proxy ignores HTTP Range (MEDIUM — seek robustness)
**File:** `backend/app/api/library.py` `stream_audio` (lines 35–58).
**Problem:** the proxy never forwards the `Range` header and always returns 200 from byte 0. ExoPlayer
(RNTP) uses Range requests to seek into unbuffered regions; without it, seeks force a full re-download
from 0 and can stutter or jump back.
**Fix:** forward the header and the upstream status/headers:
```python
@stream_router.get("/stream/{navidrome_id}")
async def stream_audio(navidrome_id: str, request: Request):
    url = navidrome.stream_url(navidrome_id)
    headers = {}
    if rng := request.headers.get("range"):
        headers["Range"] = rng
    client = httpx.AsyncClient(timeout=None)
    r = await client.send(client.build_request("GET", url, headers=headers), stream=True)
    ...existing content-type guard...
    resp_headers = {k: v for k, v in r.headers.items()
                    if k.lower() in ("content-range", "accept-ranges", "content-length")}
    return StreamingResponse(_gen(), status_code=r.status_code,
                             media_type=content_type, headers=resp_headers)
```
(Import `Request` from fastapi.) Navidrome supports Range on `format=raw` streams.
**Verify:** `curl -H "Range: bytes=100000-" .../stream/<id> -o /dev/null -D -` → `206` with
`Content-Range`. In-app seeking becomes instant.

### BE-13 — Post-download cover embed dies on lazy `song.album` load (MEDIUM)
**File:** `backend/app/services/download_pipeline.py` `_post_download_hook` line ~1064
(`album_name = song.album.title if song.album else None`).
**Problem:** `song` is loaded without `selectinload(Song.album)`; accessing `.album` on an async
session raises `MissingGreenlet`, which the surrounding `try/except` silently swallows → the
“embed cover immediately after download” path never works; covers wait for the nightly job.
**Fix:** add eager loading to all three `select(Song)` queries in `_post_download_hook`:
`.options(selectinload(Song.album))` (import `selectinload` at top of the function). Same pattern in
`download_poller.py` is NOT affected (it doesn’t touch `.album`) — leave it.
**Verify:** download a song without embedded art; log shows `post-download hook: embedded cover…`.

### BE-14 — `_count_llm_attempts` scans the entire download_jobs table in Python (MEDIUM perf)
**File:** `backend/app/jobs/playlist_health.py` lines 267–283.
**Problem:** loads every DownloadJob row (with JSONB) into memory, every 06:00 run, per unresolvable
song. With ~2000 jobs this is heavy and grows forever.
**Fix:** one JSONB containment query:
```python
from sqlalchemy import text
result = await db.execute(text("""
    SELECT count(*) FROM download_jobs,
         jsonb_array_elements(pipeline_log) AS e
    WHERE e->>'step' = 'llm_alternative'
      AND lower(e->'data'->>'llm_alt_for') = :target
      AND e->'data'->>'playlist_id' = :pl
"""), {"target": f"{artist} - {title}".lower(), "pl": playlist_id})
return result.scalar_one()
```
**Verify:** same counts; cleanup job finishes fast.

### BE-21 — `system-status` freezes the ENTIRE backend (CRITICAL — discovered live, after initial plan)
**File:** `backend/app/api/admin.py` `get_system_status` lines 156–178.
**Problem:** the endpoint runs a **synchronous** `os.walk(settings.MUSIC_DIR)` + per-file
`os.path.getsize` over NFS, inside the async handler. This blocks the asyncio event loop — while the
walk runs, **every** API request (even `/health`) hangs. The mobile settings screen polls this
endpoint **every 30 seconds** (`mobile/app/settings.tsx` line 39), so simply having Settings open
repeatedly freezes the whole backend for the duration of an NFS tree walk. Verified live: two
status requests pinned the loop hard enough that `/health` timed out for minutes.
**Fix (two parts):**
1. Never walk on demand. Add a module-level cache in `admin.py`:
   ```python
   _storage_cache: dict = {}
   _storage_cache_at: float = 0.0

   def _compute_storage_sync(music_dir: str) -> dict:
       ...the existing walk + shutil.disk_usage code...

   async def _get_storage() -> dict:
       global _storage_cache, _storage_cache_at
       import time
       if time.time() - _storage_cache_at > 1800 or not _storage_cache:
           _storage_cache = await asyncio.to_thread(_compute_storage_sync, settings.MUSIC_DIR)
           _storage_cache_at = time.time()
       return _storage_cache
   ```
   `asyncio.to_thread` keeps the loop free; the 30-min cache means the walk runs at most twice an hour
   regardless of polling.
2. Mobile: lengthen the settings poll from 30 s to 120 s (`settings.tsx` line 39) — the data is
   status-glance info, not realtime.
**Same disease elsewhere (fix together):**
- `backend/app/jobs/cover_art_job.py` `_resolve_file_path` walk (already SRC-4) — when building the
  per-run basename index, do it via `await asyncio.to_thread(...)`.
- `backend/app/services/sources/soulseek_src.py` BE-4 walk — wrap in `asyncio.to_thread`.
- `backend/app/jobs/download_poller.py` `_collect_audio_files`/`_move_to_music_dir` — small trees,
  acceptable, but wrap the os.walk in `to_thread` while you're there.
- `backend/app/api/library.py` `delete_song` `os.remove` over NFS, `eod.py` `_delete_song_file` —
  single-file ops, leave them.
**Verify:** open Settings on the phone, hammer `/health` in a loop — zero timeouts; first
system-status response may take a while (thread), subsequent ones instant.

### BE-15 — Library search only matches title (LOW)
**File:** `backend/app/api/library.py` line 142–143.
**Problem:** `?search=` matches only `Song.title`. Mobile filters client-side anyway, so this affects
only API consumers (MCP).
**Fix:** `q = q.where(or_(Song.title.ilike(f"%{search}%"), Song.display_artist.ilike(f"%{search}%"), Song.title_romanized.ilike(f"%{search}%")))`.

### BE-16 — Dead/garbage route in profiles.py (LOW, cleanup)
**File:** `backend/app/api/profiles.py` lines 99–101: `@router.post("/../songs/{song_id}/assign")`.
**Fix:** delete `_unused()` and its decorator; also delete the unused `AssignRequest` model and the
orphaned helper `assign_song_profile` if nothing imports it (grep first — nothing does).

### BE-17 — `_enrich_songs` does up to 4 sequential queries per playlist song (LOW-MED perf)
**File:** `backend/app/api/discovery.py` lines 199–340.
**Problem:** opening a daily playlist with 9 songs costs ~20–40 queries; `/discovery/today` with 4
playlists ~100+. Tolerable single-user, but it’s the home screen’s critical path.
**Fix (bounded effort):** first check `song.get("id")` — entries already stamped by the staging flow
carry their Song UUID; resolve those with ONE `WHERE id IN (...)` batch query and skip the per-song
fallback cascade for them. Keep the cascade only for unstamped entries.
**Verify:** home screen loads noticeably faster; flags still appear.

### BE-18 — archive.org download buffers whole file in RAM (LOW)
**File:** `backend/app/services/sources/archive_org_src.py` lines 86–91.
**Fix:** stream to disk:
```python
async with client.stream("GET", url) as r:
    r.raise_for_status()
    with open(dest, "wb") as fh:
        async for chunk in r.aiter_bytes(65536):
            fh.write(chunk)
```

### BE-19 — YouTube candidates get unearned cover-art points (LOW)
**File:** `backend/app/services/sources/youtube_src.py` line 81 (`has_cover_art=True`).
**Problem:** yt-dlp does not embed the thumbnail with the current options, so +5 cover points are
fake and the post-download has_cover flag is wrong.
**Fix (either):** (a) set `has_cover_art=False`; or (b) actually embed: add `"EmbedThumbnail"` to
postprocessors plus `"writethumbnail": True` in `ydl_opts`. Prefer (b) — better outcome. Note
`EmbedThumbnail` requires ffmpeg (present in image) and works for m4a/mp3.

### BE-20 — Dead code & consistency sweep (LOW)
- `backend/app/api/queue.py`: `_query_random` (lines 456–488) unused → delete. `mood_compat` computed
  (line 238) but unused in the score → delete the computation and `_mood_compat`/`_seed_mood_vec` if
  then unused.
- `_SOURCE_TIMEOUTS["soulseek"] = 100` in `download_pipeline.py` is overridden by a hardcoded 600 in
  `_search_source` → set the dict value to 600 and use it, drop the special-case branch.
- `backend/app/services/llm/*`: generators define `SYSTEM` prompts that are never sent. Either pass
  them (`[{"role":"system","content":SYSTEM}, …]` — DeepSeek supports system role; for Claude provider
  map a leading system message to the `system` kwarg) or delete the constants. Prefer passing them.
- `backend/app/api/auth.py` / `core/auth.py`: `pwd_context` unused → remove import & object.
- `backend/check_*.py`, `find_spotdl*.py`, `full_wipe.py`, `test_*.py` at backend root: one-off debug
  scripts; move to `backend/scripts/` (or delete `full_wipe.py` outright — it’s dangerous).

---

## Phase 2 — Mobile: playback & queue correctness (the “app feels broken” cluster)

> Architecture context for the implementer: RNTP (react-native-track-player) holds the *real* queue.
> Zustand mirrors it in three pieces: `queue` (the playback context, e.g. a playlist or the library
> list), `explicitQueue` (user “play next” picks), `autoQueue` (auto-radio suggestions appended at the
> end). All bugs below come from those mirrors drifting from RNTP. The repair strategy is:
> **derive, don’t mirror** — always locate tracks in RNTP by `songId`, never by arithmetic.

### MOB-1 — Tapping a song can play a different song (CRITICAL) ✅ (2026-06-12)
**Files:** `mobile/lib/audio.ts` `playSong` (lines 213–247); callers:
`mobile/app/(tabs)/index.tsx` `playFirst` (line 76–81), `mobile/app/userplaylist/[id].tsx` row
`onPress` (line 65–69).
**Problem:** `playSong` uses `useStore.getState().queue` as the playback context. The home screen’s
hero play button and the user-playlist rows **never set the queue**, so the context is whatever was
queued last (e.g. the library list). If the tapped song isn’t in that stale context,
`targetIdx = max(0, findIndex(-1)) = 0` → RNTP plays the stale queue’s first track while the UI
briefly shows the tapped song. This is the single most user-visible bug.
**Fix:** change `playSong` to take the context explicitly and stop reading global state:
```ts
export async function playSong(
  song: Song,
  streamUrl: string,
  playlistId: string | null,
  contextSongs?: Song[],          // NEW — full list this song was tapped in
) {
  const { explicitQueue } = useStore.getState();
  const base = contextSongs && contextSongs.length ? contextSongs : [song];
  const targetIdx = Math.max(0, base.findIndex(s => s.id === song.id));
  ...
}
```
Then update ALL callers to pass their list and delete their manual `setQueue` calls (playSong should
do `useStore.setState({ queue: merged, queueIndex: targetIdx })` itself — it already does):
- `app/(tabs)/library.tsx` line 427: `playSong(item, url, null, filteredSongsRef.current)`
- `app/playlist/[id].tsx` `playAll` and row onPress: pass `playableSongs` (keep mapping artist/duration defaults)
- `app/artist/[id].tsx` row onPress: pass the mapped `songs` array
- `app/userplaylist/[id].tsx`: pass `songs.filter(s => s.navidrome_id)` and **change `playlistId`
  argument to `null`** (it currently passes the UserPlaylist id, which pollutes daily-playlist
  endpoints — see MOB-4)
- `app/(tabs)/index.tsx` `playFirst`: pass `pl.songs.filter(s => s.navidrome_id)`
**Verify:** from a fresh app start, tap the home hero play → correct song; open a user playlist and
tap song 3 → song 3 plays; library still works.

### MOB-2 — Skip-to-delete is not implemented at all (CRITICAL — core product mechanic) ✅ (2026-06-12)
**Decision (Ben):** pressing next on a daily-playlist song before listen-through counts as a skip →
marked for end-of-day deletion. (The playlist screen hint text already promises exactly this.)
**Files:** `mobile/lib/audio.ts`, `mobile/lib/PlaybackService.ts`, `mobile/lib/api.ts` (`postSkip`
already exists, line 97 — currently never called).
**Fix:** add one helper in `audio.ts` and call it from both skip paths:
```ts
async function reportSkipIfDaily(): Promise<void> {
  try {
    const TrackPlayer = (await import('react-native-track-player')).default;
    const track = await TrackPlayer.getActiveTrack();
    const songId = track?.songId as string | undefined;
    const playlistId = (track?.playlistId as string | null) ?? null;
    if (!songId || !playlistId) return;          // only daily-playlist tracks carry playlistId
    const { position, duration } = await TrackPlayer.getProgress();
    const pct = duration ? Math.min(1, position / duration) : 0;
    if (pct >= 0.9) return;                       // listen-through already fired — not a skip
    api.postSkip(songId, playlistId, pct).catch(() => {});
  } catch {}
}
```
Call `await reportSkipIfDaily()` at the top of `skipToNext()` in `audio.ts` AND inside the
`Event.RemoteNext` listener in `PlaybackService.ts` (before `skipToNext`). Do **not** call it in
`skipToPrev`.
**Dependency:** correctness requires MOB-4 (only true playlist tracks carry `playlistId`).
**Verify:** play a daily playlist, skip song at 30% → entry shows red flag after playlist refresh;
backend `pending_deletions` gets a row; `/playback/skip` 204 in backend logs. Skipping a library song
sends nothing.

### MOB-3 — Queue index arithmetic corrupts the queue (HIGH) ✅ (2026-06-12)
**Files:** `mobile/lib/audio.ts` (`addToQueue` lines 295–329, `removeFromExplicitQueue` 331–340,
`moveInExplicitQueue` 342–357), `mobile/components/player/QueueSheet.tsx` `handleRemoveAutoSong`
(lines 61–73).
**Problem:** all four compute RNTP indices as `queueIndex + 1 + <offset>`, assuming explicit songs sit
immediately after the current track and autos immediately after them. When playing a playlist, the
*remaining playlist songs* occupy those positions and autos are appended at the very end → removals
remove the wrong track, “play next” inserts into the middle of the playlist remainder is fine but the
auto-removal math then deletes playlist songs, and Zustand `queue` (spliced with `rnptIdx`) diverges
further each operation.
**Fix:** replace index arithmetic with id-based lookup against the real RNTP queue in all four places:
```ts
async function rnptIndexOf(songId: string): Promise<number> {
  const TrackPlayer = (await import('react-native-track-player')).default;
  const q = await TrackPlayer.getQueue();
  return q.findIndex((t: any) => t.songId === songId);
}
```
- `removeFromExplicitQueue(index)`: get `song = explicitQueue[index]`, find `rnptIndexOf(song.id)`,
  remove that; update `explicitQueue` by index and rebuild `queue` from RNTP
  (`useStore.setState({ queue: (await TrackPlayer.getQueue()).map(trackToSong) })` — write a small
  `trackToSong` mapper mirroring `_buildTrack`).
- `moveInExplicitQueue(from,to)`: find both RNTP indices by id, `TrackPlayer.move(a, b)`, rebuild.
- `addToQueue`: insert after `rnptIndexOf(currentTrack.songId) + explicitQueue.length` **computed via
  ids** — i.e. find the RNTP index of the last explicit song (or current track if none) and insert
  after it. Don’t pre-remove autos (that was only needed because of the arithmetic); autos stay at the
  tail and `fillAutoQueue` already tops up to 5.
- `QueueSheet.handleRemoveAutoSong`: use `rnptIndexOf(song.id)`.
Edge: duplicate songIds in queue — acceptable for now (single-user); note it.
**Verify:** play a 9-song daily playlist, queue 2 library songs “next”, open queue sheet, remove an
auto song and an explicit song, reorder explicit songs → playback order in RNTP matches the sheet, no
playlist songs vanish.

### MOB-4 — Every queued track inherits the daily playlist id (HIGH — corrupts skip/keep stats) ✅ (2026-06-12)
**File:** `mobile/lib/audio.ts` `playSong` line 232 (`merged.map(s => _buildTrack(s, playlistId))`).
**Problem:** when playing from a daily playlist, the spliced-in `explicitQueue` songs (library songs)
also get `playlistId` → their progress/listen-through/skip events are attributed to the daily
playlist; with MOB-2 they could even be marked for deletion.
**Fix:** tag only context songs:
```ts
const contextIds = new Set(base.map(s => s.id));
await TrackPlayer.add(merged.map(s =>
  _buildTrack(s, contextIds.has(s.id) ? playlistId : null)));
```
(With MOB-1’s `base` = contextSongs.)
**Verify:** queue a library song while a daily playlist plays; let it finish → no flag appears on it.

### MOB-5 — Dead player controls (HIGH UX — “buttons that do nothing”) ✅ (2026-06-12)
**File:** `mobile/components/player/FullPlayer.tsx`.
Four controls render but do nothing:
1. **Shuffle** (line 214): implement queue shuffle of the *remaining* tracks:
   ```ts
   const TrackPlayer = ...; const q = await TrackPlayer.getQueue();
   const idx = await TrackPlayer.getActiveTrackIndex();
   // Fisher-Yates the indices after idx via repeated TrackPlayer.move
   ```
   Keep a `shuffleOn` boolean in Zustand for the icon tint; re-shuffling on each press is fine,
   un-shuffle is NOT required (document in code comment).
2. **Repeat** (line 229): cycle RNTP repeat mode Off → Queue → Track. `TrackPlayer.setRepeatMode`,
   store the mode in Zustand, tint icon when ≠ Off, show small “1” dot for Track (copy the pattern
   used for active tint elsewhere; a `Text` superscript is fine).
3. **Heart** (line 171): currently local state only. **Decision:** when the current track has a
   `playlistId` (daily), heart = “keep”: call `api.flagSong(playlistId, songId, 'keep')` and fill the
   icon; for non-daily tracks hide the heart entirely (`playlistId == null`). No favorites system
   exists server-side — do not invent one.
4. **Dots menu** (line 138): open `SongActionSheet` for the current song (import it; manage a local
   `actionOpen` state; pass `{id: currentSong.id, title: currentSong.title}`; on delete close player).
5. **Auto-radio Stay/Open toggle** (lines 243–256): move `stayInProfile` into Zustand
   (`radioScope: 'profile' | 'library'`, persisted in AsyncStorage like isDark) and use it in
   `fillAutoQueue` (`audio.ts` line ~160): when `'library'`, pass `radioProfileId = undefined` so the
   backend picks across the whole library. (Backend treats missing profile_id as no filter — verified
   in `_query_by_vector`.)
**Verify:** each control visibly does something and survives app restart where applicable.

### MOB-6 — Playlist screen’s shuffle button does nothing (MEDIUM) ✅ (2026-06-12)
**File:** `mobile/app/playlist/[id].tsx` lines 162–166.
**Fix:** onPress: shuffle a copy of `playableSongs` (Fisher-Yates), then `playSong(shuffled[0],
getStreamUrl(shuffled[0].navidrome_id), id, shuffled)` (per MOB-1 signature).

### MOB-7 — Pending-deletion screen renders empty rows (MEDIUM) ✅ (2026-06-12)
**File:** `mobile/app/deletion.tsx` lines 40–57.
**Problem:** API returns flat `{song_id, title, artist_name, marked_at}` (see
`backend/app/api/deletion.py` `PendingItem`), but the screen reads `item.song?.title` /
`item.song?.artist_name` → every row shows “—”. Also `keyExtractor={(p) => p.id}` — no `id` field.
**Fix:** `keyExtractor={(p) => p.song_id}`; render `item.title` and `item.artist_name`.
**Verify:** skip a daily song (after MOB-2), open Pending deletion → real titles; Keep removes row.

### MOB-8 — Home screen is stale (MEDIUM) ✅ (2026-06-12)
**File:** `mobile/app/(tabs)/index.tsx` lines 53–63.
**Problem:** data loads only when `activeProfileId` changes — returning from a playlist, or after the
nightly generation, the screen keeps yesterday’s state until profile switch/app restart.
**Fix:** wrap the three fetches in a `load()` and call from `useFocusEffect` (import from expo-router)
instead of plain `useEffect`; ALSO add `RefreshControl` to the ScrollView for pull-to-refresh. Keep
the `activeProfileId` dependency.
**Verify:** flag a song in a playlist, go back → hero/cards reflect it after refocus.

### MOB-9 — Daily-playlist slot labels never match (LOW) ✅ (2026-06-12)
**File:** `mobile/app/(tabs)/library.tsx` lines 26–31.
**Problem:** keys are `close_match/broader_taste/new_genre/artist_of_day` but backend slots are
`close/broader/genre/artist` → badges always show the raw slot uppercased.
**Fix:** replace the map keys with `close`, `broader`, `genre`, `artist`.

### MOB-10 — Genre prompt uses iOS-only `Alert.prompt` and can’t pick an existing profile (MEDIUM) ✅ (2026-06-12)
**File:** `mobile/app/(tabs)/index.tsx` lines 165–180.
**Problem:** on Android (`Alert.prompt` undefined) accepting a genre prompt silently creates a new
profile named after the genre — the user can never type a name or choose an existing profile. Project
rule: use `TextInputModal`, never `Alert.prompt`.
**Fix:** on Accept for `genre_prompt`, open `ProfilePickerModal` (with `onPick`) listing profiles plus
its “All Music only” row repurposed — better: add a state
`genrePromptNotif` and render a `ProfilePickerModal` + a “New profile…” path: picking a profile calls
`handleNotifAction(notif, true, profileId)`; a dedicated “Create new” row (add an optional
`extraOption` prop to ProfilePickerModal, or chain a `TextInputModal` after a “New profile…” button)
calls `handleNotifAction(notif, true, 'new', typedName)`. Keep `artist_prompt` accept as-is.
**Verify:** on Android, accepting a genre prompt lets you choose target profile or name a new one.

### MOB-11 — Queue sheet hides the upcoming playlist songs (MEDIUM) ✅ (2026-06-12)
**File:** `mobile/components/player/QueueSheet.tsx`.
**Problem:** the sheet shows only `explicitQueue` + `autoQueue`. When a playlist is playing, the
actual next tracks (rest of the playlist) are invisible → “queue is empty” while music clearly has a
next song. (FullPlayer’s “up next” does include them, inconsistently.)
**Fix:** derive the remainder: `const { queue, queueIndex, explicitQueue, autoQueue } = useStore();`
`const upcomingContext = queue.slice(queueIndex + 1).filter(s => !explicitQueue.some(e => e.id===s.id) && !autoQueue.some(a => a.id===s.id));`
Render a third section `FROM PLAYLIST` (non-draggable, no remove button) between the explicit and
auto sections. After MOB-3 the `queue` mirror is rebuilt from RNTP so this is accurate.
**Verify:** play a playlist → queue sheet lists its remaining songs.

### MOB-12 — Library cache hard-refetches forever if the stamp endpoint fails (MEDIUM, resilience) ✅ (2026-06-12)
**File:** `mobile/app/(tabs)/library.tsx` `refreshIfStale` (lines 242–265).
**Problem:** `const stale = !serverStamp || …` — any stamp failure (offline, old backend, 500) triggers
a full 5000-song + artists refetch, every 15 s. This is what was happening in production against the
stale backend.
**Fix:**
```ts
if (!serverStamp) return;                 // can't tell — do nothing this tick
const stale = serverStamp.updated_at !== cachedStamp;
if (!stale) return;
```
**Verify:** with backend stopped, the app idles quietly on cache; with backend up, edits propagate
within 15 s.

### MOB-13 — `api.req` discards backend error details (LOW) ✅ (2026-06-12)
**File:** `mobile/lib/api.ts` lines 15–24.
**Fix:** include the response body’s `detail` when present:
```ts
if (!r.ok) {
  let msg = `${method} ${path} → ${r.status}`;
  try { const j = await r.json(); if (j?.detail) msg = typeof j.detail === 'string' ? j.detail : msg; } catch {}
  throw new Error(msg);
}
```
**Verify:** importing a non-Spotify URL shows the real message (“Must be a Spotify URL…”).

### MOB-14 — Login screen hardcodes version `v1.0.0-b9` (LOW) ✅ (2026-06-12)
**File:** `mobile/app/login.tsx` line 39.
**Fix:** `import Constants from 'expo-constants'` →
`` `Connect to your server · v${Constants.expoConfig?.version ?? '?'}` ``.

### MOB-15 — ProfileMenu: unsupported `oklch()` color and emoji icons (LOW, visual) ✅ (2026-06-12)
**File:** `mobile/components/profile/ProfileMenu.tsx` line 97 + `items` array (lines 51–70).
**Problem:** React Native cannot parse `oklch(70% 0.08 ${hue})` → the avatar circle renders with no
background. The menu icons are unicode glyphs (◷ ◈ ⚙ ✕ ⌂ ›) — violates the project’s Icon-component
rule and renders inconsistently.
**Fix:** background `hsl(${hue}, 35%, 60%)` (same helper the home screen uses — move `profileHue` into
a shared util or duplicate); replace icons: history → `<Icon name="history">`, profiles →
`<Icon name="artist">`, settings → `<Icon name="settings">`, close ✕ → `<Icon name="close">`,
chevron › → `<Icon name="chevronRight">`, hint ⌂ → `<Icon name="home" size={12}>`.

### MOB-16 — Notification badge math uses stale state (LOW) ✅ (2026-06-12)
**File:** `mobile/app/notifications.tsx` lines 73 & 101 (`setNotificationCount(Math.max(0,
notifs.length - 1))` inside closures over old `notifs`).
**Fix:** compute from the updated list: `setNotifs(n => { const next = n.filter(x => x.id !== id);
setNotificationCount(next.length); return next; });`

### MOB-17 — Deprecated `TrackPlayer.getState()` (LOW) ✅ (2026-06-12)
**File:** `mobile/lib/audio.ts` `togglePlay` line 250.
**Fix:** `const { state } = await TrackPlayer.getPlaybackState();`

### MOB-18 — TouchableOpacity → Pressable sweep (LOW, consistency; fold into design phase if preferred) ✅ (2026-06-12)
Project rule: `Pressable` everywhere. Files still using `TouchableOpacity`: `app/artist/[id].tsx`,
`app/userplaylist/[id].tsx`, `app/settings.tsx`, `app/downloads.tsx`, `app/notifications.tsx`,
`app/history.tsx`, `app/deletion.tsx`, `app/login.tsx`, `components/profile/ProfileMenu.tsx`,
`app/_layout.tsx` (ErrorBoundary). Mechanical replacement, keep press feedback via
`style={({pressed}) => …}`.

---

## Phase 3 — Discovery / daily-playlist pipeline

### DSC-1 — Genre slot dead in production
Covered by OPS-2 (redeploy repo `new_genre.py`). Verify per OPS-2 step 5.

### DSC-2 — Artist-of-the-day EOD prompt dead
Covered by BE-2. After both BE-2 and OPS-2, the full loop is: listen ≥80% of artist playlist → EOD
creates `artist_prompt` → home screen card (already implemented) → accept follows/adds artist.

### DSC-3 — `_fetch_candidates` is slow and serial (MEDIUM)
**File:** `backend/app/discovery/close_match.py` lines 76–107 (used by broader_taste too).
**Problem:** for 8 seed artists it serially calls last.fm similar (8×), ListenBrainz similar (8×),
then `get_top_tracks` for EVERY similar artist (~potentially 100+ sequential HTTP calls). Nightly run
for 13 profiles × 2 slots multiplies this — generation takes a very long time and hammers last.fm.
**Fix:** cap and parallelize:
1. After collecting + deduping similar-artist names, cap to 25 names total before fetching top tracks.
2. Fetch top tracks concurrently: `results = await asyncio.gather(*[lastfm.get_top_tracks(n, limit=3) for n in capped])` (the helpers already swallow errors).
3. Keep rejected/library filtering as is.
**Verify:** time `generate_for_profile` before/after (log timestamps already exist).

### DSC-4 — Same candidate pool fetched twice per profile (LOW-MED)
`generate_for_profile` calls `close_match.generate` and `broader_taste.generate`, each doing its own
identical `_fetch_candidates` run. **Fix:** fetch once in `pipeline.generate_for_profile` and pass
`candidates` into both generators (add optional `candidates=None` parameter that skips the fetch when
provided). Combine with DSC-3.

### DSC-5 — Nightly runs EOD twice (LOW, correctness-adjacent)
`run_nightly` calls `run_eod_batch()` at 02:00, and the scheduler ALSO runs `run_eod_batch` at 23:45.
Intentional catch-up? It re-processes leftovers; the batch is idempotent-ish (consumed flags, deleted
events). Leave, but add a comment in `nightly.py` stating it’s a deliberate second pass.

### DSC-6 (optional enhancement, Ben-approved direction) — Web-search-grounded genre picks
Re-add the container hotfix idea properly: in `new_genre.generate`, if
`get_settings().LLM_PROVIDER == "claude"`, pass the Anthropic web-search tool
(`{"type": "web_search_20250305", "name": "web_search"}`) via a new optional `tools=` parameter on the
provider protocol; `DeepSeekProvider.complete` must IGNORE non-OpenAI-format tools (or simply never
receive them — gate at call site). Default DeepSeek path stays tool-free. Low priority.

### DSC-7 — Genre/artist EOD deletes never-played staged songs (decision documented)
`_process_genre`/`_process_artist` delete staged songs that were neither listened nor skipped once the
80% threshold trips. This is BY DESIGN (the playlist is “done”, leftovers are discarded) — do not
“fix”. Add a code comment so future models don’t flag it.

---

## Phase 4 — Download pipeline & sources

### SRC-1 — Soulseek result/state handling — BE-3 + BE-4 (above). Highest impact in this phase.

### SRC-2 — Stale `queued` backlog drains too slowly after restarts (MEDIUM)
**Observation:** 123 jobs sat `queued` with only 4 `downloading`. `request_download` fires
`_run_pipeline` as an asyncio task gated by `Semaphore(4)`; a container restart wipes those tasks, and
startup only resets them to `failed` → they wait for the 15-min retry job, which re-queues ALL of them
at once into the semaphore — with soulseek’s 600 s ceiling, worst-case throughput is ~4 jobs/10 min.
**Fix (bounded):**
1. In `retry_failed_downloads` (`backend/app/jobs/download_retry.py`), order by `next_retry_at` and cap
   per run: `.order_by(DownloadJob.next_retry_at).limit(25)`. The 15-min cadence then drains steadily
   without a thundering herd.
2. Keep `_PIPELINE_SEM = 4` (matches soulseek slots — documented invariant).
**Verify:** after restart with a large backlog, `queued+downloading` shrinks every 15 min, API stays responsive.

### SRC-3 — `is_acceptable` floor with no MB match (LOW, documented behavior)
With no MusicBrainz reference, identity is hardcoded 20/40 → always passes the ≥15 gate; scoring then
mostly ranks by source/quality. Acceptable by design (MB pre-resolution covers most cases). No change;
comment exists in scoring.py.

### SRC-4 — Cover-art job walks the whole music tree per song (MEDIUM perf)
**File:** `backend/app/jobs/cover_art_job.py` `_resolve_file_path` (lines 63–71).
**Problem:** for every cover-less song whose job path is missing, it `os.walk`s the entire NFS music
library. N songs × full tree walk nightly.
**Fix:** build one basename index per job run: in `scan_missing_covers`/`retry_missing_covers`, before
`_process_songs`, walk MUSIC_DIR once into `dict[basename, fullpath]` and pass it through to
`_resolve_file_path` (new parameter) for O(1) lookups.

### SRC-5 — Upgrade pipeline can strand files (LOW)
`_run_upgrade_pipeline` deletes the old file only when the new score is better; when the re-run
*fails*, job state was reset to `queued`→ pipeline → possibly `failed`, while the old file still
exists and `file_path` was preserved? Actually `retry`-style reset clears nothing here, but
`_run_pipeline_inner` overwrites `file_path` only on success. Residual risk: new file downloaded with
score ≤ old+5 → new file is NOT deleted and not referenced (orphan on disk).
**Fix:** in `_run_upgrade_pipeline`, in the `else` branch (kept original), if
`job.file_path != old_path` delete `job.file_path`’s new orphan and restore `job.file_path = old_path`
plus the old score fields. Read the function carefully before editing — preserve the early-return paths.

### SRC-6 — `prowlarr_src` candidate title is the *query* title (LOW, scoring accuracy)
Candidates are built with `title=job.title, artist=job.artist` (the search terms!) instead of the
torrent’s actual `result_title` → identity scoring compares the query to itself and always scores
high, even for wrong torrents. The real name is stashed in `download_ref.title`.
**Fix:** keep `title=title` for display but score against reality: set
`metadata={"torrent_title": result_title}` … better minimal change: set the Candidate’s `title` to
`result_title` and let `_strip_version_suffix`/fuzzy matching do its job; keep `artist=artist`.
**Caution:** torrent names are noisy (`Artist - Title [FLAC] 2019`); fuzzy partial_ratio handles this
reasonably. Watch acceptance rates after deploying; if prowlarr candidates start getting rejected too
aggressively, revert and instead penalize only exact-dup query echo. Flag results in the verify step.
**Verify:** queue a track with active seeders; inspect `candidates` JSONB — prowlarr entries show real
torrent names and plausible identity scores.

### SRC-7 — spotdl `.spotdl` temp files leak on the search path (LOW)
`search()` keeps `save_path` for the download phase, but if the pipeline never calls
`spotdl_src.download` (another source wins), the file leaks in `/tmp`. OPS-3’s janitor covers it;
optionally also delete `save_path` in `download()`’s no-op path and after scoring losers (not worth
plumbing — janitor suffices).

---

## Phase 5 — Cleanups & small consistency items

### CLN-1 — `backend/app/api/discovery.py` consume endpoint unused by mobile; keep (used by EOD/morning cleanup logic and possibly MCP). No action.
### CLN-2 — `mobile/lib/api.ts`: remove `getQueue`/`appendQueue` (after BE-7), `getAutoRadio` single (unused — only batch is used).
### CLN-3 — `SongRow` `theme.success`/`theme.danger`/`theme.error` don’t exist in tokens — add `success: '#22c55e'`-style tokens to `mobile/lib/tokens.ts` (light+dark variants) and use them in SongRow, SongActionSheet, downloads/notifications screens instead of hex literals.
### CLN-4 — `mobile/app/(tabs)/library.tsx`: `getPlaylists()` (daily) isn’t refreshed by the 15 s loop or focus — add it to the `useFocusEffect` that refreshes artists.
### CLN-5 — `backend/app/api/playlists.py`: `uuid.UUID(playlist_id)` raises ValueError → 500 for malformed ids. Wrap in try/except → `HTTPException(422)`. Same in discovery.py `get_playlist` (it takes raw str into `db.get` — Postgres will error on bad uuid).
### CLN-6 — `backend/Dockerfile` / requirements: confirm `mcp` package is in requirements (CLAUDE.md says it was patch-installed). If not, add it so the next image rebuild doesn’t silently lose `/mcp`.
### CLN-7 — DB hygiene (ask Ben, then): delete profiles `__temp__` (clearly script debris). `White Girl`, `Elektro`, `Nightcore` are real but empty-ish — leave unless Ben says otherwise.
### CLN-8 — `mobile/app.json` version vs login screen vs releases — single source: app.json (MOB-14 handles the login screen).

### CLN-9 — One-time library cleanup: ~1,900 orphaned songs (do AFTER OPS-2 + BE-9 + BE-2)
**Live finding:** the DB holds **2,327 songs but only 353 are profile-assigned**. Ben wants a
500–700-song library. The unassigned bulk is debris from years of broken machinery: staged
daily-playlist downloads that EOD never processed (BE-2 crash), skipped songs never deleted, and
wrong/duplicate downloads — all invisible-ish in “All Music”.
**Procedure (one-time, interactive with Ben — do NOT bulk-delete autonomously):**
1. Prerequisites deployed: OPS-2 (staged filter live), BE-9 (sync can’t wipe assignments),
   BE-2 (EOD works), BE-6 (profile deletes work).
2. `GET /api/v1/admin/export-library` → JSON of all songs with profiles.
3. Triage in three buckets: (a) keep+assign (Ben sorts or a model proposes assignments from
   artist/genre), (b) keep unassigned (intentional All-Music-only), (c) delete. The MCP
   `get_library` tool exposes `from_daily_playlist` — discovery-sourced songs Ben never assigned are
   prime delete candidates.
4. Apply via `POST /api/v1/admin/apply-library` in batches of ~200 (each delete removes the file and
   the endpoint triggers one Navidrome rescan at the end — batching avoids long request times).
5. Afterwards run `POST /admin/sync`, verify counts, and clean orphaned `download_jobs` rows whose
   `file_path` no longer exists (optional SQL pass).
Also delete the `__temp__` profile (confirmed debris) once empty.

---

## Phase 6 — OFFLINE-1: Song download for local playback (NEW FEATURE, Ben-requested)

Goal: songs play from device storage when available — Spotify-style offline. Streaming stays the
fallback. Scope is mobile-only (the backend already serves files via `/stream/{navidrome_id}`).

**Architecture:**
- New module `mobile/lib/offlineCache.ts`:
  - Storage: `FileSystem.documentDirectory + 'audio/<navidrome_id>'` (no extension needed; RNTP/Exo
    sniffs containers; if issues arise, derive ext from the response `content-type`).
  - Index in AsyncStorage `@offline/index/v1`: `Record<navidromeId, {path, bytes, savedAt}>` kept in
    a module-level map, hydrated at app start.
  - API: `isCached(id)`, `localUri(id)`, `downloadOne(id, streamUrl)` (FileSystem.downloadAsync →
    on success update index), `removeOne(id)`, `totalBytes()`, `clearAll()`.
  - Download queue: simple sequential async loop (max 2 concurrent), driven by
    `syncOfflineForSongs(songs: {navidrome_id}[])` — downloads missing, optionally evicts items no
    longer in the requested set (only those auto-downloaded; track an `auto: boolean` flag in the
    index so manually pinned songs survive).
- Playback integration: in `audio.ts` `_buildTrack`, `url: offlineCache.localUri(song.navidrome_id)
  ?? api.getStreamUrl(...)`. Cover art keeps streaming (small).
- Auto-download policy (Settings → new "OFFLINE" section):
  - Toggle "Download my music for offline" (default off).
  - When on: after each library refresh, call `syncOfflineForSongs(allSongs.filter(s => s.profile_id))`
    — i.e. profile-assigned songs only (Ben's curated 500–700), NOT the unassigned All-Music bulk.
  - Wi-Fi-only switch (use `expo-network` `getNetworkStateAsync`, skip downloads on cellular).
  - Show: count cached / total, total MB, "Clear offline storage" row.
- Per-song manual pin: add "Download offline" / "Remove download" row to `SongActionSheet` (icon:
  `download`), flagging `auto: false` entries.
- UI affordance: in `SongRow`, when `isCached(song.navidrome_id)`, render a tiny accent `download`
  icon (10px) next to the duration. Keep it subtle.
- Eviction/safety: hard cap (default 4 GB) — before downloading, if over cap, evict oldest
  `auto:true` entries. Never evict pinned.
**Verify:** enable offline, wait for sync, enable airplane mode + kill server → cached songs play,
uncached songs show a toast "Not available offline" (guard in playSong: if no network and not cached,
skip with feedback).

---

## Suggested implementation order (for scheduling across sessions)

1. **OPS-2 prerequisites:** BE-1, BE-2, **BE-21** → then OPS-2 redeploy + verify. (Single session, backend only.)
2. **OPS-3, BE-9, BE-10** (leak janitor, sync data-loss guard, notification dedup + one-time dismiss-all). Backend.
3. **BE-3, BE-4, SRC-2** (soulseek correctness + backlog drain). Backend.
4. **MOB-1, MOB-4, MOB-2, MOB-3** in that order (they touch the same functions — do as ONE mobile
   session; MOB-1 changes `playSong`’s signature first, then MOB-4’s per-track playlistId, then MOB-2’s
   skip reporting, then MOB-3’s id-based queue ops). Then MOB-7, MOB-8. Build + release APK.
5. **BE-5, BE-6, BE-12, BE-13, BE-17** (backend perf/correctness batch). Redeploy.
6. **MOB-5, MOB-6, MOB-10, MOB-11, MOB-12, MOB-13** (player controls + UX batch). Release APK.
7. **DSC-3, DSC-4, SRC-4, SRC-6, BE-14** (pipeline performance batch).
8. **Phase 5 cleanups + MOB-9, MOB-14..18** opportunistically with whatever session touches those files.
9. **OPS-4** lands with the NAS migration (separate, deliberate operation — out of scope here).

Each backend batch ends with: patch-upload changed files → restart → run the verify steps of every
item in the batch → commit with item IDs in the message. Each mobile batch ends with: gradle release
build → version bump in `app.json` → GitHub release (mandatory, see CLAUDE.md).

## Explicitly out of scope for the fix phase (tracked for the redesign phase)

- Full visual redesign of the front end (Ben wants Fable to design this; current fixes must not
  restyle screens beyond what’s needed for correctness).
- Waveform-in-FullPlayer per the design spec (FullPlayer currently uses a plain progress bar;
  MiniPlayer has the waveform).
- A real favorites/heart system (MOB-5 maps heart to daily-keep only).
- Web-search-grounded genre generation (DSC-6, optional).
- NAS migration `infra/MIGRATION_STREAMING.md` (operational project, not a code fix).
