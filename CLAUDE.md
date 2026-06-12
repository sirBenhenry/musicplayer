# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Self-hosted personal music streaming app. Single-user. Backend (FastAPI + PostgreSQL) on Docker host `10.1.8.4`, mobile app (React Native / Expo bare) sideloaded on Android.

Design reference (read-only, do not modify): `music-app/` — visual spec, tokens, interaction model.

---

## Build & run

### Backend

No local Docker in the dev environment (WSL). All backend operations go through the Portainer API.

**Deploy changed Python files without rebuilding the image** (the normal workflow):
```bash
# Auth (JWTs expire — re-auth on 401)
TOKEN=$(curl -s -k -X POST https://10.1.8.4:9443/api/auth \
  -H 'Content-Type: application/json' \
  -d '{"username":"ben","password":"Passw0rd@docker"}' \
  | grep -o '"jwt":"[^"]*"' | cut -d'"' -f4)

CONTAINER_ID="f05355dcf876"  # music-backend

# Upload a file (repeat per file)
tar -cf /tmp/patch.tar -C backend/app/api playlists.py
curl -s -k -X PUT \
  "https://10.1.8.4:9443/api/endpoints/3/docker/containers/${CONTAINER_ID}/archive?path=/app/app/api" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/x-tar" \
  --data-binary @/tmp/patch.tar

# Restart
curl -s -k -X POST \
  "https://10.1.8.4:9443/api/endpoints/3/docker/containers/${CONTAINER_ID}/restart" \
  -H "Authorization: Bearer $TOKEN"
```

**Run a command in the container** (e.g. migration):
```bash
EXEC_ID=$(curl -s -k -X POST \
  "https://10.1.8.4:9443/api/endpoints/3/docker/containers/${CONTAINER_ID}/exec" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"Cmd":["alembic","upgrade","head"],"AttachStdout":true,"AttachStderr":true,"WorkingDir":"/app"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['Id'])")
curl -s -k -X POST \
  "https://10.1.8.4:9443/api/endpoints/3/docker/exec/${EXEC_ID}/start" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"Detach":false}'
```

For standalone Python scripts, add `"WorkingDir":"/app"` and `"Env":["PYTHONPATH=/app"]` to the exec payload. Prefer `asyncpg` over SQLAlchemy ORM in scripts — see note under Backend architecture.

**Full image rebuild** (only needed for dependency or Dockerfile changes):
```bash
cd backend && docker build -t music-backend:latest .
cd infra && docker compose -p musicapp up -d
```

Backend exposed at `http://10.1.8.4:8001` (host:8001 → container:8000). Port 8000 on the host is the Portainer agent — do not use it.

**App credentials** (from container env): `APP_USERNAME=admin`, `APP_PASSWORD=musicapp123`. DB: `postgresql://musicapp:musicapp_db_pass_2024@postgres:5432/musicapp`.

**Trigger manual library sync / daily generation:**
```bash
curl -X POST http://10.1.8.4:8001/api/v1/admin/sync -H "Authorization: Bearer <token>"
curl -X POST http://10.1.8.4:8001/api/v1/admin/generate -H "Authorization: Bearer <token>"
```

### Mobile

```bash
cd mobile
npm install

# Dev server
npx expo start

# Release APK (local Gradle build — no EAS)
cd android
./gradlew assembleRelease --no-daemon
# APK: android/app/build/outputs/apk/release/app-release.apk

# Install to connected device
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

**After every `./gradlew assembleRelease`**, bump `mobile/app.json` version and publish a GitHub Release — no exceptions:
```bash
gh release create v1.x.y \
  android/app/build/outputs/apk/release/app-release.apk \
  --title "v1.x.y" --repo sirBenhenry/musicplayer
```
The in-app "Check for update" button hits the GitHub releases API and compares `tag_name` vs `expo-constants` version. Repo must stay public.

---

## Infrastructure

```
Portainer: https://10.1.8.4:9443  (always use -k, self-signed)
Endpoint ID: 3
Credentials: ben / Passw0rd@docker
```

**musicapp stack** (`infra/docker-compose.yml`):
- `navidrome` :4533 — Subsonic music server (source of truth for library)
- `lidarr` :8686 — artist monitoring + new release downloads
- `musicapp-postgres` — PostgreSQL 16 + pgvector (internal only)
- `slskd` :5030 — Soulseek client (`/api/v1/application` returns 404 in this version; use `/api/v1/searches` as liveness probe)
- `music-backend` :8001 — FastAPI backend (container ID `f05355dcf876`)
- `navidrome` container ID `2c7960b5aee0` — has `sqlite3` but NO Python; shell is busybox

**Shared from aniapp stack** (host IP, not Docker network):
- qBittorrent: `http://10.1.8.4:8080` — category `music`, saves to `/data/music/torrents/music`
- Prowlarr: `http://10.1.8.4:9696`

**NAS** (Synology `10.1.8.16`):
- `:/volume2/streaming/musicapp` → Docker volume `musicapp_music_data`
  - `media/music/` — Navidrome library root, Lidarr root folder
  - `torrents/music/` — qBittorrent staging, Lidarr import source

**NAS migration** (still pending): See `infra/MIGRATION_STREAMING.md`.

**Navidrome SQLite DB**: `/data/navidrome/navidrome.db` inside Navidrome container. `media_file` table holds actual disk-relative paths (relative to the Navidrome library root `media/music/`). Use this when you need real file paths for deletion or cleanup — `songs.file_path` in our PostgreSQL stores Navidrome's **metadata-based virtual path** (e.g. `Artist Name/Album/Track.m4a` constructed from tags), NOT the actual disk path.

**Cross-container bridge pattern**: `/data/music` (the NAS mount) is accessible from both `music-backend` and `navidrome` containers. To run SQLite or shell operations in Navidrome (which has no Python): write a shell script from the backend container to `/data/music/_script.sh`, then exec it via Portainer in the Navidrome container. Navidrome busybox `find` has no `-regextype` — pipe through `grep -E` for regex filtering.

**Navidrome auth** (for API calls inside scripts): `POST http://navidrome:4533/auth/login` body `{"username":"admin","password":"admin"}` → `token` field. Use header `X-Nd-Authorization: Bearer <token>`. Note: Navidrome has no REST scanner API (`/api/scanner/*` returns 404) — trigger rescan by restarting the container.

## Git / SSH

```
git@github-personal:sirBenhenry/musicplayer.git
```
`github-personal` SSH alias = personal account (`sirBenhenry`). Never change to plain `github.com` (that maps to work account `im25a-gonnetb`).

---

## Backend architecture

`backend/` — FastAPI, Python 3.12, SQLAlchemy async, Alembic migrations, APScheduler.

```
app/
  api/          # Route handlers — one file per domain
  core/         # config.py, database.py, auth.py, scheduler.py
  models/       # SQLAlchemy ORM
    library.py      # Artist, Album, Song
    events.py       # SongEvent, PendingDeletion, RejectedSong, DownloadJob, UserNotification
    discovery.py    # DailyPlaylist, PlaylistHistory, GenreHistory
    profile.py      # Profile
    playlists.py    # UserPlaylist (user-created)
  services/     # External integrations
    navidrome.py, lidarr.py, prowlarr.py, qbittorrent.py
    download_pipeline.py   # central coordinator
    scoring.py             # confidence scoring for download candidates
    fingerprint_svc.py     # AcoustID fingerprinting (fpcalc + acoustid.org lookup) — identity fallback
    spotify_import.py      # runs `spotdl save <url>` subprocess → returns (playlist_name, songs[])
    discography_importer.py  # bulk artist discography import helper
    sources/               # prowlarr_src, soulseek_src, youtube_src, archive_org_src, qobuz_src, spotdl_src
                           # each implements search(job) → list[Candidate] and download(candidate, dest) → (bool, path)
    sources/base.py        # Candidate dataclass
    musicbrainz.py         # get_release_groups, search_recordings, get_artist_recordings, get_recording
    llm/                   # claude.py + deepseek.py + ollama.py behind LLMProvider protocol
    lastfm.py, listenbrainz.py, essentia_svc.py
  discovery/    # Pipeline generators: pipeline.py, close_match.py, broader_taste.py, new_genre.py, artist_of_day.py
  jobs/         # APScheduler jobs: library_sync, nightly, eod, download_poller, download_retry
```

**Auth**: single-user JWT. `POST /api/v1/auth/login` → token. All routes require `Authorization: Bearer`. API prefix: `/api/v1/`.

**Daily playlist generation**: enabled — all non-catchall profiles have `daily_auto_generate=TRUE`. `DAILY_GENERATION_CRON` runs at 02:00 nightly and calls `run_nightly()` → `run_discovery()` → `generate_for_profile()` per profile. Each profile gets up to 4 slots (close, broader, genre, artist). Trigger manually via `POST /admin/generate`.

**Scheduled jobs**:
- `LIBRARY_SYNC_CRON` (default `0 * * * *`) — upsert Navidrome songs/artists/albums into DB
- `DAILY_GENERATION_CRON` (default `0 2 * * *`) — run nightly (EOD + discovery pipeline for `daily_auto_generate=True` profiles)
- `EOD_CRON` (default `45 23 * * *`) — process completed daily playlists (assign listened songs to profile, delete skipped songs)
- Every 2 min — poll qBittorrent for completed `music` torrents
- Every 15 min — retry failed download jobs with backoff
- Every 30 min — `playlist_song_retry`: reset failed/exhausted jobs for active daily playlist songs, create missing jobs
- Daily 06:00 — `playlist_morning_cleanup`: remove songs still unresolvable from playlist JSONB; consume empty playlists

**Download pipeline** (`services/download_pipeline.py`):
Sources run in parallel (`asyncio.gather`), each with per-source timeouts (`_SOURCE_TIMEOUTS`: prowlarr 120s, soulseek 600s, spotdl 60s, youtube/archive 30s). `_PIPELINE_SEM = Semaphore(4)` caps concurrent pipelines — intentionally matches soulseek's internal `Semaphore(4)` so every running pipeline gets a soulseek slot immediately without queue starvation. All candidates collected, scored by `scoring.py`, best candidate downloaded. If download fails, tries next-ranked candidate (up to 5 attempts). After download: MB tags written to file → Navidrome rescan → 10s sleep → `run_library_sync()` → Essentia analysis.

Soulseek gets a 600s outer timeout (not the 100s default) because `soulseek_src` has its own internal `Semaphore(4)` queue — applying a tight outer timeout would cancel searches still waiting for a slot. Trust the source's own 90s polling loop.

**Prowlarr source special case**: `prowlarr_src.download()` queues a torrent in qBittorrent and returns `(True, None)` — file path is unknown until the torrent finishes. The pipeline detects `winner.source == "prowlarr"` and exits early, leaving the job at `status="downloading"`. The qBittorrent poller (`jobs/download_poller.py`) handles completion: detects torrent done, collects ALL audio files from `content_path`, moves them to `MUSIC_DIR`, matches each job to its best file via rapidfuzz title similarity, writes MB tags, then triggers Navidrome rescan + library sync.

`prowlarr_src` filters two ways before queuing: (1) skip 0-seeder results, (2) skip results >150MB for `item_type="track"` jobs — oversized results are album/discography torrents that would waste a qBittorrent slot. `qbittorrent.add_torrent()` identifies the newly added torrent by diffing the hash set before/after adding (5 retry polls). Never use `torrents[-1]` as a fallback — it returns a random existing torrent.

**Prowlarr stale torrent reset**: `download_poller._reset_stale_prowlarr_jobs()` runs at the top of every 2-min poll. Checks all `status='downloading'` jobs with a `qb_hash`. If the torrent exists in qBittorrent with `progress < 0.01` AND `added_on` timestamp is 1h+ old → marks job `failed`, clears `qb_hash`, calls `qbittorrent.delete_torrent()`. Uses qBittorrent's `added_on` Unix timestamp (not job `created_at`) to avoid resetting jobs that were just queued.

**Non-prowlarr stale pipeline reset**: `download_poller._reset_stale_pipeline_jobs()` also runs each poll. Finds `status='downloading'` jobs with no `qb_hash` where `pipeline_log[0].ts < NOW() - 2h` (JSONB timestamp query). Marks them `failed` with `next_retry_at = now - 1min` so the retry job picks them up immediately. Uses `pipeline_log[0].ts` not `created_at` — retried jobs reset the log, so `created_at` would be wrong.

Dedup check at pipeline start — three levels in order:
1. Active DownloadJob (`queued` or `downloading`) with same artist+title → return it immediately, no new job.
2. Completed DownloadJob with same artist+title and live file on disk → reuse, skip re-download.
3. **`songs` table** — exact case-insensitive title+artist match → song already in library (original Navidrome library, or job was cleaned up). Creates a synthetic `completed` DownloadJob with `pipeline_log` step `"skipped"` and returns immediately. Optionally assigns `profile_id` if provided and song is currently unassigned.

This means importing a song that's already in the library (by any path: Spotify import, daily playlist, manual, original library) will never trigger a download. Safe deletion: before removing a file on rejection, checks no other completed job references it.

AcoustID fallback: if identity score < 15 and `ACOUSTID_API_KEY` set → fingerprint file with fpcalc → lookup → if confirmed, override identity to 35.

The pipeline extracts a `SimpleNamespace` from the ORM object before closing the DB session — sources receive plain values, not ORM objects. DB reopened separately to write results. This pattern avoids `DetachedInstanceError`.

**Scoring** (`scoring.py`): identity(0-40) + quality(0-25) + source(0-15) + metadata(0-15) + cover_art(0-5) = 100 max. `is_acceptable` gates on identity ≥ 15 only (metadata gate removed). `review_status` set to `pending_review` if total < 55, `bad_quality` if quality < 10. Romanization (`pykakasi` → `unidecode` fallback) applied when title contains non-ASCII for cross-script fuzzy matching.

**`DownloadJob` key fields**: `status` (queued|downloading|completed|failed|exhausted), `mb_recording_id`, `candidates` (JSONB, all found), `selected_candidate`, `confidence_score`, `quality_score`, `review_status` (pending_review|confirmed|wrong_song|bad_quality), `file_path`, `pipeline_log` (append-only step log), `auto_expires_at`, `user_playlist_id` (FK → `user_playlists.id`, set when download was queued as part of a UserPlaylist import).

**Daily playlist staging flow**: when a song is downloaded for a daily playlist (`job.playlist_id` is set), the post-download hook sets `song.is_staged = True` AND writes the song's UUID back into the `DailyPlaylist.songs` JSONB entry that matches by artist+title. This JSONB write is critical — EOD reads `known_songs = [s for s in pl.songs if s.get("id")]` and skips entries without `id`. The same write happens in `download_poller.py` for prowlarr-sourced downloads. Staged songs are invisible in the library and auto-radio until EOD processes them.

**EOD slot behaviour** (`jobs/eod.py`): close/broader slots → REFILL mode (trigger at ≥5 interacted songs, assign listened songs to profile, delete skipped songs, refill holes with new LLM suggestions, keep `consumed=False`). genre/artist slots → PROMPT mode (trigger at ≥80% completion, create `UserNotification` with `type=genre_prompt` or `artist_prompt`, mark `consumed=True`). Staged guard: only blocks *deletion* of non-staged songs — never blocks assignment. `refill_playlist()` in `discovery/pipeline.py` handles hole-filling via LLM → last.fm fallback.

**`playlist_id` vs `user_playlist_id`**: `DownloadJob.playlist_id` is a FK to `daily_playlists` (auto-generated). `DownloadJob.user_playlist_id` is a FK to `user_playlists` (user-created). Never use `playlist_id` for UserPlaylist references. Both the `_post_download_hook` (pipeline path) and `download_poller.py` (prowlarr/torrent path) auto-add completed songs to `UserPlaylist.songs` JSONB when `user_playlist_id` is set. Always call `flag_modified(upl, "songs")` after mutating the list.

**`mb:UUID` inline prefix**: `request_download()` accepts `mb:UUID` or `mb:UUID Song Title` as the `title` argument. The regex strips the prefix, sets `mb_recording_id`, and uses the remaining text as title (or fetches from MusicBrainz if empty). Works in all import paths.

**Library sync**: `jobs/library_sync.py::run_library_sync()` — upserts Navidrome artists/albums/songs into local DB. Deletes stale songs (no longer in Navidrome index). Must be called after any Navidrome rescan that should surface songs in the app. Calls `bump_library_stamp()` at completion so mobile knows to refresh.

**Library stamp** (`api/library.py`): module-level `_library_stamp` datetime updated by `bump_library_stamp()` on every mutation (delete, profile assign, follow/unfollow) and after `run_library_sync()`. `GET /api/v1/songs/stamp` returns `{updated_at: str}`. This endpoint must be defined BEFORE `GET /songs/{song_id}` in the router — literal "stamp" would otherwise match the `{song_id}` path param.

**`GET /songs` performance**: uses `defer(Song.feature_vector)` (skips 1280-float vector — 5KB per song) and `selectinload(Song.artist)` + `selectinload(Song.album)` (eliminates N+1 queries). Without these, loading 600 songs previously triggered 1254 DB round-trips and transferred 3MB of vector data per request.

**Critical path format**: `Songs.file_path` stores Navidrome-relative paths (e.g. `Ado/song.m4a`, no leading slash, relative to `MUSIC_DIR`). `DownloadJob.file_path` stores absolute container paths (`/data/music/media/music/Ado/song.m4a`). Never compare these directly — strip `settings.MUSIC_DIR + "/"` from the job path before doing a DB lookup against `Song.file_path`.

**`Song.profile_id`**: `NULL` means unassigned — visible **only in the catchall profile** ("All Music"). The library endpoint `GET /songs?profile=<id>` filters as `profile_id = <id>` for specific profiles (strict, no `OR profile_id IS NULL`) and shows all songs for catchall. `GET /songs` returns up to 5000 songs ordered by title. `DELETE /songs/{id}` removes the file from disk, deletes the DB record, and triggers a Navidrome rescan. `PATCH /songs/{id}/profile` body `{profile_id: string|null}` — sets profile assignment (clears `needs_profile_assignment`). Only songs explicitly downloaded with a `profile_id` on the job get assigned.

**Artist follow vs add**: `Artist` has two independent states — `followed: bool` (appears in "Following" section of library) and `lidarr_id` (has Lidarr monitoring). `ArtistOut` exposes `monitored: bool = lidarr_id is not None`. Two endpoints: `POST /artists/{id}/add` sets `followed=True` only (no Lidarr — "In Library" state); `POST /artists/{id}/follow` sets `followed=True` AND adds to Lidarr ("Following" state). `DELETE /artists/{id}/follow` sets `followed=False` and removes from Lidarr if `lidarr_id` is set — works for both states. `GET /artists?profile_id=<uuid>` returns artists with at least one song assigned to that profile (via EXISTS subquery on `songs.profile_id`).

**Download cancel**: `POST /downloads/{id}/cancel` — marks `queued` or `downloading` job as `failed`, clears `qb_hash`, calls `qbittorrent.delete_torrent()` if applicable. `POST /downloads/{id}/retry` does a full fresh restart: clears `candidates`, `pipeline_log`, `sources_tried`, `retry_count`, then runs pipeline immediately — no cached data reused.

**Stuck downloading on restart**: `main.py` lifespan resets all `status IN ('downloading','queued')` → `'failed'` with `next_retry_at = now - 1min` on startup. The 15-min retry job then re-queues them automatically. Never manually delete or force-reset stuck downloading jobs — the restart cycle handles it. Trigger immediate retry via `POST /api/v1/admin/retry-downloads`.

**Import endpoints** (`api/admin.py`):
- `POST /admin/import-songs` — body: `[{artist, title, mb_recording_id?}]` — queues downloads for a list of tracks
- `POST /admin/import-setup` — body: `{profiles?, songs?, playlists?}` — creates missing profiles (by name), queues song downloads, creates UserPlaylists and queues their songs with `user_playlist_id` set
- `POST /admin/device-logs` — body: `{logs: str}` — receives crash/debug logs from mobile, writes to container `/tmp/device_debug.log` and logs at WARNING level

**Spotify import** (`api/playlists.py`): `POST /playlists/import-spotify` — body `{url, profile_id?}` — runs `spotdl save <url>` via `spotify_import.py`, creates UserPlaylist, queues downloads with `user_playlist_id`. Returns `{playlist_id, name, track_count, jobs}`.

**MusicBrainz pre-resolution** (`services/mb_resolver.py`): `resolve_recording(artist, title)` → `mb_recording_id | None`. Searches MB with `studio` filter, returns ID only if score ≥ 80. Called by `discovery/downloader.py` before every `request_download()` — space calls ≥1.1s apart (MB rate limit). Songs resolved this way go into the pipeline with exact MB identity anchor → identity score 40/40.

**MCP server** (`app/mcp_server.py`): FastMCP, streamable HTTP transport, mounted at `/mcp`, session manager started in FastAPI lifespan. Endpoint: `http://10.1.8.4:8001/mcp/` (note trailing slash). Connected to Claude Desktop via `mcp-remote` stdio proxy (`npx -y mcp-remote http://10.1.8.4:8001/mcp/ --allow-http`). 26 tools covering search/download, library CRUD, artists, playlists, profiles, downloads. Key bulk tools: `bulk_assign_profile(song_ids, profile_id)`, `bulk_reassign_songs([{song_id, profile_id}])`, `bulk_delete_songs(song_ids)`, `bulk_queue_downloads(tracks, profile_id)` — use these for batch operations instead of calling single-item tools in a loop. `get_library` includes `from_daily_playlist` field (true = downloaded by discovery system, not original library). Configure `transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False)` to allow LAN IP access. Requires `mcp>=1.0.0` — installed in image via patch-build.

**Standalone scripts in container**: Prefer `asyncpg` with raw SQL over SQLAlchemy ORM. ORM requires importing ALL model modules first or triggers `NoReferencedTableError` (FK resolution fails for unimported tables). Use `asyncpg.connect("postgresql://musicapp:musicapp_db_pass_2024@postgres:5432/musicapp")`.

**LLM** (`services/llm/`): default provider is `deepseek` (`LLM_PROVIDER=deepseek`, `DEEPSEEK_MODEL=deepseek-chat`). Set `DEEPSEEK_API_KEY` env var. Without a key, each generator returns `[]` (caught exception) → no daily playlists created. Switch to Claude via `LLM_PROVIDER=claude` + `ANTHROPIC_API_KEY`.

---

## Mobile architecture

`mobile/` — Expo bare workflow (React Native 0.76, Expo 52). `android/` folder present — builds with Gradle, no EAS. Old Architecture (`newArchEnabled: false`). Version tracked in `mobile/app.json`.

```
app/
  (tabs)/           # Tab screens: index (home), library, search
  artist/[id].tsx
  playlist/[id].tsx       # Daily/discovery playlist detail
  userplaylist/[id].tsx   # User-created playlist detail
  analysis.tsx            # Audio analysis progress monitor
  downloads.tsx, deletion.tsx, history.tsx, notifications.tsx, settings.tsx, login.tsx
  _layout.tsx       # Root: fonts, auth guard, FullPlayer overlay
components/
  chrome/MiniPlayer.tsx
  player/FullPlayer.tsx, Waveform.tsx
  profile/RadialSwitcher.tsx, ProfileMenu.tsx
  shared/CoverArt.tsx, SongRow.tsx, Icon.tsx, PlaylistPickerModal.tsx, TextInputModal.tsx, ArtistImportModal.tsx, SongActionSheet.tsx, ProfilePickerModal.tsx
lib/
  api.ts            # All backend calls (fetch wrapper)
  audio.ts          # react-native-track-player wrapper, progress tracking, 90% listen-through
  libraryCache.ts   # AsyncStorage cache for songs + artists (stale-while-revalidate)
  logger.ts         # File-based crash/debug logger, flushed to AsyncStorage
  PlaybackService.ts # RNTP headless JS background task (remote controls, auto-radio)
  store.ts          # Zustand: auth, profiles, playback, queue, theme
  tokens.ts         # Design tokens — getTheme(isDark, isSage)
hooks/
  useTheme.ts  # Returns theme object from Zustand isDark/isSage state
```

**State**: Zustand (`lib/store.ts`) — auth token + serverUrl (persisted in AsyncStorage), active profile, playback state, queue, theme. Hydrated on app start.

**Audio**: `lib/audio.ts` wraps `react-native-track-player` v4.1.2 (RNTP). Background playback, lock-screen controls, and Android media notification are handled by RNTP's foreground service — no expo-av. `setupAudio()` calls `TrackPlayer.setupPlayer()` + `updateOptions()` once at app start (idempotent — ignores "already set up" error). Event listeners (`PlaybackState`, `PlaybackActiveTrackChanged`, `PlaybackProgressUpdated`) sync RNTP state back into Zustand. `playSong()` calls `TrackPlayer.reset()` + `add(tracks)` + `skip(idx)` + `play()`. Progress → `POST /api/v1/playback/progress` every 5s (via `progressUpdateEventInterval: 5`). At 90% → `POST /api/v1/playback/listen-through`. `AppKilledPlaybackBehavior.ContinuePlayback` — music survives app force-kill.

**Entry point**: `mobile/index.js` (not `expo-router/entry` directly). Uses `require()` — not `import` — to enforce execution order: registers `PlaybackService` before React root mounts, then calls `initLogger()` to capture JS errors before the React tree exists. `mobile/lib/PlaybackService.ts` is the headless JS background task handling `RemotePlay/Pause/Stop/Seek/Next/RemotePreviousTrack` and `PlaybackQueueEnded` (auto-radio fetch). `RemotePreviousTrack`: if position > 3s → `seekTo(0)`, else `skipToPrevious()`.

**Logger** (`lib/logger.ts`): continuous file-based logger writing to AsyncStorage (`@debug_log/v1`), capped at 500 lines (drops oldest). `initLogger()` installs `ErrorUtils.setGlobalHandler` + `console.error` override. `appendLog(msg)` buffers and flushes with 2s debounce. `flushNow()` for immediate flush from error handlers. `sendDeviceLogs` API call posts to `POST /admin/device-logs`. Settings screen has "Send Logs to server" + "Clear logs" buttons. `ErrorBoundary.componentDidCatch` in `_layout.tsx` also writes to log.

**Library cache** (`lib/libraryCache.ts`): stale-while-revalidate pattern. On init: load songs + artists from AsyncStorage immediately (zero-latency first paint), then check `GET /songs/stamp` against cached stamp — full refresh only when stamp differs. Background poll every 15s. Profile switching is client-side only (filter `allSongs` by `profile_id === activeProfileId`) — no server call. `forceRefresh()` called after local mutations (delete, profile assign).

**Player overlay**: `FullPlayer` is mounted at root layout level (`app/_layout.tsx`) and controlled by `playerOpen` Zustand bool — visible on all screens. `MiniPlayer` is mounted inside `(tabs)/_layout.tsx` so it only appears on the three tab screens (home, library, search); navigating to any stack screen hides it automatically. MiniPlayer has `zIndex: 10`; it hides when `profileMenuOpen` is true (ProfileMenu bottom sheet is view-based, not a Modal). RadialSwitcher renders at `zIndex: 20` so its backdrop dims the MiniPlayer.

**`Icon` component** (`shared/Icon.tsx`): stroke-based SVG icon set matching the design. Props: `name`, `color`, `size` (default 22), `strokeWidth` (default 1.6). Never use emoji or unicode symbols for icons — always use this component. Available names: home, library, search, play, pause, skip, prev, shuffle, repeat, heart, heartFill, dots, plus, check, chevronDown, chevronRight, close, trash, settings, download, refresh, list, filter, radio, history, artist, sparkle, arrowLeft, notification.

**`SongRow` component**: `React.memo` wrapper — stable props required for memo to be effective. `onSwipeQueue` prop activates a `GestureDetector` (pan gesture) per row; do NOT pass `onSwipeQueue` in the library Songs FlatList — on old arch, GestureDetectors are expensive to mount during fast scroll and cause jank. Use `onLongPress` → `SongActionSheet` for actions instead.

**`SongActionSheet`**: bottom-sheet modal (`animationType="slide"`) with handle bar. Three actions: "Add to playlist" → `PlaylistPickerModal`, "Assign profile" → `ProfilePickerModal`, "Delete song" → `Alert.alert` confirm → `DELETE /songs/{id}`. Opened via long-press in library/playlist screens.

**`ProfilePickerModal`**: centered fade modal listing all non-catchall profiles. Single-select — tapping a row calls `PATCH /songs/{id}/profile` immediately and closes. "All Music only" row sets `profile_id = null`. Checkmark shown on current assignment.

**`TextInputModal`**: cross-platform text input dialog (replaces iOS-only `Alert.prompt`). Use for any user text input (create/rename).

**UI primitives**: use `Pressable` (not `TouchableOpacity`) everywhere. `Pressable` style prop accepts a function `({ pressed }) => [...]` for press feedback.

**Playlist types**: two distinct kinds — `DailyPlaylist` (auto-generated by discovery, route `/playlist/[id]`) and `UserPlaylist` (user-created, route `/userplaylist/[id]`). Songs in `UserPlaylist` are stored as JSONB snapshots `{id, navidrome_id, title, artist, duration_sec}`.

**Library Artists tab**: two sections when active profile is not catchall — "Following" (top, artists with `followed=true`) and profile-name section (bottom, artists with songs assigned to this profile who are not followed). Built client-side from `allArtists` + `allSongs`. Refreshes via `useFocusEffect` on return from artist detail.

**`req<void>` and 204 responses**: `lib/api.ts`'s `req<T>` returns `undefined as T` for HTTP 204 responses instead of calling `r.json()`. All void endpoints (follow, unfollow, add artist, cancel download, etc.) return 204 — never return a JSON body from them or the client will silently fail.

**`isDaily: true`** is the gate for the skip-to-delete / listen-through-to-keep mechanic. Never apply to library or user playlists.

**Radial profile switcher** (`components/profile/RadialSwitcher.tsx` + `app/(tabs)/_layout.tsx`):
- Long-press 280ms on center home button → nodes appear in grid rows above anchor
- Gesture: `Gesture.Simultaneous(longPress, pan)`. `isOpen.value = true` set in the LongPress `onStart` worklet (UI thread) — NOT in the JS-thread callback — to avoid a race where `onFinalize` fires before JS runs
- `pan.minDistance(8)` prevents pan from competing with longpress during hold
- Anchor pre-measured via `onLayout` + `homeRef.current?.measure()` into `anchorRef` — `openRadial` is synchronous with no async measure call
- No SVG connector lines (they appeared at final positions while nodes spring in from anchor — visually wrong)
- `elevation: 0` on Android for profile nodes — Android old arch renders circular-view elevation as polygon approximation (hexagonal at large radii); shadows disabled via `Platform.OS === 'android'` check

---

## Design system

Tokens in `mobile/lib/tokens.ts` (source of truth). Design spec in `music-app/project/styles.css`.

- **Fonts**: `Geist` (UI), `InstrumentSerif` (display headings), `GeistMono` (labels/timestamps)
- **Themes**: light/dark × terracotta/sage — `getTheme(isDark, isSage)`
- **Radii**: covers 10, cards/sheets 14, petals 18, pills 100
- **Shadows**: warm-tinted always (`rgba(40,25,15,…)` light, `rgba(0,0,0,…)` dark)
- Never hardcode colors — always use theme object from `useTheme()`

**Waveform**: SVG, 54 bars × 1.5px, 1.5px gaps, heights seeded from song ID (deterministic). Played bars: accent at 85–100%. Unplayed: fgSoft at 32%.

**Mini-player → full player morph**: originates from mini-player rect (`bottom:80, left/right:8, height:72, borderRadius:14`). MiniPlayer shows cover (52px), title, artist + waveform row, accent circle play button (44px).

---

## Cover art

`getCoverUrl(navidrome_id)` from `lib/api.ts` returns `/api/v1/cover/{navidrome_id}`. Cover art proxy adds `Cache-Control: max-age=86400`. For playlist cards on the home screen, use the first song's navidrome_id: `pl.songs?.find(s => s.navidrome_id)` then `getCoverUrl(song.navidrome_id)`.

---

## Audio analysis & auto-radio

**Essentia analysis** (`services/essentia_svc.py`): extracts a 1280-dim EffnetDiscogs embedding (`feature_vector`) + BPM, key/mode, mood scores (5 heads), and vibe features. Runs after every download completes. Trigger a full re-analysis via `POST /api/v1/admin/analyse-resume` (idempotent — skips songs where `analysed_at IS NOT NULL`). Progress: `GET /api/v1/admin/analysis-status`. Monitor screen: `app/analysis.tsx`.

**Song audio fields** on `Song`:
- `feature_vector` — 1280-dim pgvector embedding (L2-normalised); `NULL` until analysis runs. Always use `defer(Song.feature_vector)` in list queries — 5KB per song, not needed for display
- `bpm`, `key_root`, `key_mode` (`"major"` / `"minor"`)
- `mood_happy/sad/aggressive/relaxed/party` — Essentia mood model scores (0–1); these score flatly (~0.65 across all songs) and are **not used in radio scoring**
- `beat_strength` — onset energy normalised 0–1; higher = more groove/pulse
- `spectral_centroid` — brightness normalised 0–1; higher = brighter timbre
- `dyn_complexity` — RMS std dev; saturates at 1.0 for most songs, **not used in radio scoring**

**BPM detection quirk**: librosa returns quantised values (117.1875, 125.0, 144.23…). Many unrelated songs share the same discrete BPM. Don't assume same-BPM means similar feel.

**Auto-radio** (`api/queue.py`):
- `GET /queue/auto-radio-batch?song_id=X&count=N&profile_id=Y&banned_ids=a,b,c` — chains N picks: B from A, C from B, etc.
- Hard SQL filters applied when both `key_mode` and `bpm` are known: mode must match; BPM within ±20% (plus half/double tempo windows). If filtered pool < 5, retries without filters.
- Scoring: cosine similarity 50% + BPM compat 20% + mode compat 15% + vibe compat 15%. Vibe = `beat_strength` (60%) + `spectral_centroid` (40%).
- Softmax temperature `T=0.05` (very tight — near-deterministic top pick).
- Same-artist penalty: −0.30. Recency decay: exponential, half-life 4h, max −0.55.
- Catchall profile: pass **no `profile_id`** — catchall songs have `profile_id=NULL`, not the catchall UUID. Mobile detects this via `is_catchall` flag and omits the param.

**Admin endpoints**:
- `POST /admin/analyse-resume` — queue analysis for all unanalysed songs
- `POST /admin/sync` — trigger library sync
- `POST /admin/generate` — trigger daily playlist generation
- `POST /admin/retry-downloads` — immediately retry all failed download jobs
- `POST /admin/import-songs` — bulk song download queue
- `POST /admin/import-setup` — full setup file (profiles + songs + playlists)
- `POST /admin/device-logs` — receive crash/debug logs from mobile

---

## DB migrations

Migrations in `backend/alembic/versions/`. Current head: `0016` (`data JSON` column on `user_notifications` — stores structured payload for `genre_prompt` and `artist_prompt` notification types). Add new migration file with `down_revision` pointing to current head, then run via the container exec pattern above.
