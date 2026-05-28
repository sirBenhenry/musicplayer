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

CONTAINER_ID="bfaecb35ad30"  # music-backend

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
- `music-backend` :8001 — FastAPI backend (container ID `bfaecb35ad30`)

**Shared from aniapp stack** (host IP, not Docker network):
- qBittorrent: `http://10.1.8.4:8080` — category `music`, saves to `/data/music/torrents/music`
- Prowlarr: `http://10.1.8.4:9696`

**NAS** (Synology `10.1.8.16`):
- `:/volume2/streaming/musicapp` → Docker volume `musicapp_music_data`
  - `media/music/` — Navidrome library root, Lidarr root folder
  - `torrents/music/` — qBittorrent staging, Lidarr import source

**NAS migration** (still pending): See `infra/MIGRATION_STREAMING.md`.

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

**Scheduled jobs**:
- `LIBRARY_SYNC_CRON` (default `0 * * * *`) — upsert Navidrome songs/artists/albums into DB
- `DAILY_GENERATION_CRON` (default `0 2 * * *`) — run discovery pipeline for each profile
- `EOD_CRON` (default `45 23 * * *`) — process pending deletions
- Every 2 min — poll qBittorrent for completed `music` torrents
- Every 15 min — retry failed download jobs with backoff

**Download pipeline** (`services/download_pipeline.py`):
Sources run in parallel (`asyncio.gather`), each with per-source timeouts (`_SOURCE_TIMEOUTS`: prowlarr 120s, soulseek 600s, spotdl 60s, youtube/archive 30s). `_PIPELINE_SEM = Semaphore(4)` caps concurrent pipelines — intentionally matches soulseek's internal `Semaphore(4)` so every running pipeline gets a soulseek slot immediately without queue starvation. All candidates collected, scored by `scoring.py`, best candidate downloaded. If download fails, tries next-ranked candidate (up to 5 attempts). After download: MB tags written to file → Navidrome rescan → 10s sleep → `run_library_sync()` → Essentia analysis.

Soulseek gets a 600s outer timeout (not the 100s default) because `soulseek_src` has its own internal `Semaphore(4)` queue — applying a tight outer timeout would cancel searches still waiting for a slot. Trust the source's own 90s polling loop.

**Prowlarr source special case**: `prowlarr_src.download()` queues a torrent in qBittorrent and returns `(True, None)` — file path is unknown until the torrent finishes. The pipeline detects `winner.source == "prowlarr"` and exits early, leaving the job at `status="downloading"`. The qBittorrent poller (`jobs/download_poller.py`) handles completion: detects torrent done, collects ALL audio files from `content_path`, moves them to `MUSIC_DIR`, matches each job to its best file via rapidfuzz title similarity, writes MB tags, then triggers Navidrome rescan + library sync.

`prowlarr_src` filters two ways before queuing: (1) skip 0-seeder results, (2) skip results >150MB for `item_type="track"` jobs — oversized results are album/discography torrents that would waste a qBittorrent slot. `qbittorrent.add_torrent()` identifies the newly added torrent by diffing the hash set before/after adding (5 retry polls). Never use `torrents[-1]` as a fallback — it returns a random existing torrent.

**Prowlarr stale torrent reset**: `download_poller._reset_stale_prowlarr_jobs()` runs at the top of every 2-min poll. Checks all `status='downloading'` jobs with a `qb_hash`. If the torrent exists in qBittorrent with `progress < 0.01` AND `added_on` timestamp is 1h+ old → marks job `failed`, clears `qb_hash`, calls `qbittorrent.delete_torrent()`. Uses qBittorrent's `added_on` Unix timestamp (not job `created_at`) to avoid resetting jobs that were just queued.

**Non-prowlarr stale pipeline reset**: `download_poller._reset_stale_pipeline_jobs()` also runs each poll. Finds `status='downloading'` jobs with no `qb_hash` where `pipeline_log[0].ts < NOW() - 2h` (JSONB timestamp query). Marks them `failed` with `next_retry_at = now - 1min` so the retry job picks them up immediately. Uses `pipeline_log[0].ts` not `created_at` — retried jobs reset the log, so `created_at` would be wrong.

Dedup check at pipeline start: if same artist+title already has a `completed` job with a live file, reuse it (skip re-download). Safe deletion: before removing a file on rejection, checks no other completed job references it.

AcoustID fallback: if identity score < 15 and `ACOUSTID_API_KEY` set → fingerprint file with fpcalc → lookup → if confirmed, override identity to 35.

The pipeline extracts a `SimpleNamespace` from the ORM object before closing the DB session — sources receive plain values, not ORM objects. DB reopened separately to write results. This pattern avoids `DetachedInstanceError`.

**Scoring** (`scoring.py`): identity(0-40) + quality(0-25) + source(0-15) + metadata(0-15) + cover_art(0-5) = 100 max. `is_acceptable` gates on identity ≥ 15 only (metadata gate removed). `review_status` set to `pending_review` if total < 55, `bad_quality` if quality < 10. Romanization (`pykakasi` → `unidecode` fallback) applied when title contains non-ASCII for cross-script fuzzy matching.

**`DownloadJob` key fields**: `status` (queued|downloading|completed|failed|exhausted), `mb_recording_id`, `candidates` (JSONB, all found), `selected_candidate`, `confidence_score`, `quality_score`, `review_status` (pending_review|confirmed|wrong_song|bad_quality), `file_path`, `pipeline_log` (append-only step log), `auto_expires_at`, `user_playlist_id` (FK → `user_playlists.id`, set when download was queued as part of a UserPlaylist import).

**`playlist_id` vs `user_playlist_id`**: `DownloadJob.playlist_id` is a FK to `daily_playlists` (auto-generated). `DownloadJob.user_playlist_id` is a FK to `user_playlists` (user-created). Never use `playlist_id` for UserPlaylist references. Both the `_post_download_hook` (pipeline path) and `download_poller.py` (prowlarr/torrent path) auto-add completed songs to `UserPlaylist.songs` JSONB when `user_playlist_id` is set. Always call `flag_modified(upl, "songs")` after mutating the list.

**`mb:UUID` inline prefix**: `request_download()` accepts `mb:UUID` or `mb:UUID Song Title` as the `title` argument. The regex strips the prefix, sets `mb_recording_id`, and uses the remaining text as title (or fetches from MusicBrainz if empty). Works in all import paths.

**Library sync**: `jobs/library_sync.py::run_library_sync()` — upserts Navidrome artists/albums/songs into local DB. Deletes stale songs (no longer in Navidrome index). Must be called after any Navidrome rescan that should surface songs in the app.

**Critical path format**: `Songs.file_path` stores Navidrome-relative paths (e.g. `Ado/song.m4a`, no leading slash, relative to `MUSIC_DIR`). `DownloadJob.file_path` stores absolute container paths (`/data/music/media/music/Ado/song.m4a`). Never compare these directly — strip `settings.MUSIC_DIR + "/"` from the job path before doing a DB lookup against `Song.file_path`.

**`Song.profile_id`**: `NULL` means unassigned — visible **only in the catchall profile** ("All Music"). The library endpoint `GET /songs?profile=<id>` filters as `profile_id = <id>` for specific profiles (strict, no `OR profile_id IS NULL`) and shows all songs for catchall. `GET /songs` returns up to 5000 songs ordered by title. `DELETE /songs/{id}` removes the file from disk, deletes the DB record, and triggers a Navidrome rescan. `PATCH /songs/{id}/profile` body `{profile_id: string|null}` — sets profile assignment (clears `needs_profile_assignment`). Only songs explicitly downloaded with a `profile_id` on the job get assigned. Library's `filterProfile` toggle auto-enables when switching to a non-catchall profile.

**Artist follow vs add**: `Artist` has two independent states — `followed: bool` (appears in "Following" section of library) and `lidarr_id` (has Lidarr monitoring). `ArtistOut` exposes `monitored: bool = lidarr_id is not None`. Two endpoints: `POST /artists/{id}/add` sets `followed=True` only (no Lidarr — "In Library" state); `POST /artists/{id}/follow` sets `followed=True` AND adds to Lidarr ("Following" state). `DELETE /artists/{id}/follow` sets `followed=False` and removes from Lidarr if `lidarr_id` is set — works for both states. `GET /artists?profile_id=<uuid>` returns artists with at least one song assigned to that profile (via EXISTS subquery on `songs.profile_id`).

**Download cancel**: `POST /downloads/{id}/cancel` — marks `queued` or `downloading` job as `failed`, clears `qb_hash`, calls `qbittorrent.delete_torrent()` if applicable. `POST /downloads/{id}/retry` does a full fresh restart: clears `candidates`, `pipeline_log`, `sources_tried`, `retry_count`, then runs pipeline immediately — no cached data reused.

**Stuck downloading on restart**: `main.py` lifespan resets all `status IN ('downloading','queued')` → `'failed'` with `next_retry_at = now - 1min` on startup. The 15-min retry job then re-queues them automatically. Never manually delete or force-reset stuck downloading jobs — the restart cycle handles it. Trigger immediate retry via `POST /api/v1/admin/retry-downloads`.

**Standalone scripts in container**: Prefer `asyncpg` with raw SQL over SQLAlchemy ORM. ORM requires importing ALL model modules first or triggers `NoReferencedTableError` (FK resolution fails for unimported tables). Use `asyncpg.connect("postgresql://musicapp:musicapp_db_pass_2024@postgres:5432/musicapp")`.

**LLM** (`services/llm/`): default provider is `deepseek` (`LLM_PROVIDER=deepseek`, `DEEPSEEK_MODEL=deepseek-chat`). Set `DEEPSEEK_API_KEY` env var. Without a key, each generator returns `[]` (caught exception) → no daily playlists created. Switch to Claude via `LLM_PROVIDER=claude` + `ANTHROPIC_API_KEY`.

---

## Mobile architecture

`mobile/` — Expo bare workflow (React Native 0.76, Expo 52). `android/` folder present — builds with Gradle, no EAS. Version tracked in `mobile/app.json`.

```
app/
  (tabs)/           # Tab screens: index (home), library, search
  artist/[id].tsx
  playlist/[id].tsx       # Daily/discovery playlist detail
  userplaylist/[id].tsx   # User-created playlist detail
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
  PlaybackService.ts # RNTP headless JS background task (remote controls, auto-radio)
  store.ts          # Zustand: auth, profiles, playback, queue, theme
  tokens.ts         # Design tokens — getTheme(isDark, isSage)
hooks/
  useTheme.ts  # Returns theme object from Zustand isDark/isSage state
```

**State**: Zustand (`lib/store.ts`) — auth token + serverUrl (persisted in AsyncStorage), active profile, playback state, queue, theme. Hydrated on app start.

**Audio**: `lib/audio.ts` wraps `react-native-track-player` v4.1.2 (RNTP). Background playback, lock-screen controls, and Android media notification are handled by RNTP's foreground service — no expo-av. `setupAudio()` calls `TrackPlayer.setupPlayer()` + `updateOptions()` once at app start (idempotent — ignores "already set up" error). Event listeners (`PlaybackState`, `PlaybackActiveTrackChanged`, `PlaybackProgressUpdated`) sync RNTP state back into Zustand. `playSong()` calls `TrackPlayer.reset()` + `add(tracks)` + `skip(idx)` + `play()`. Progress → `POST /api/v1/playback/progress` every 5s (via `progressUpdateEventInterval: 5`). At 90% → `POST /api/v1/playback/listen-through`. `AppKilledPlaybackBehavior.ContinuePlayback` — music survives app force-kill.

**Entry point**: `mobile/index.js` (not `expo-router/entry` directly). Uses `require()` — not `import` — to enforce execution order: registers `PlaybackService` before React root mounts. `mobile/lib/PlaybackService.ts` is the headless JS background task handling `RemotePlay/Pause/Stop/Seek/Next/RemotePreviousTrack` and `PlaybackQueueEnded` (auto-radio fetch). `RemotePreviousTrack`: if position > 3s → `seekTo(0)`, else `skipToPrevious()`.

**Player overlay**: `FullPlayer` is mounted at root layout level (`app/_layout.tsx`) and controlled by `playerOpen` Zustand bool — visible on all screens. `MiniPlayer` is mounted inside `(tabs)/_layout.tsx` so it only appears on the three tab screens (home, library, search); navigating to any stack screen (settings, downloads, artist pages, etc.) hides it automatically. MiniPlayer has `zIndex: 10`; it hides when `profileMenuOpen` is true (ProfileMenu bottom sheet is view-based, not a Modal). RadialSwitcher renders at `zIndex: 20` so its backdrop dims the MiniPlayer rather than the player hiding during profile switching.

**`Icon` component** (`shared/Icon.tsx`): stroke-based SVG icon set matching the design. Props: `name`, `color`, `size` (default 22), `strokeWidth` (default 1.6). Never use emoji or unicode symbols for icons — always use this component. Available names: home, library, search, play, pause, skip, prev, shuffle, repeat, heart, heartFill, dots, plus, check, chevronDown, chevronRight, close, trash, settings, download, refresh, list, filter, radio, history, artist, sparkle, arrowLeft, notification.

**`SongRow` component**: accepts `onLongPress` for contextual actions (e.g. add to playlist). Always use `rightAction` prop for inline action buttons rather than wrapping. `song` prop accepts `title_romanized` (shown below title in mono) and `display_artist` (feat. credits).

**`SongActionSheet`**: bottom-sheet modal (`animationType="slide"`) with handle bar. Three actions: "Add to playlist" → `PlaylistPickerModal`, "Assign profile" → `ProfilePickerModal`, "Delete song" → `Alert.alert` confirm → `DELETE /songs/{id}`. Opened via long-press in library/playlist screens. Props: `visible`, `song: {id, title}`, `onClose`, `onAddToPlaylist`, `onAssignProfile`, `onDeleted`.

**`ProfilePickerModal`**: centered fade modal listing all non-catchall profiles. Single-select — tapping a row calls `PATCH /songs/{id}/profile` immediately and closes. "All Music only" row sets `profile_id = null`. Checkmark shown on current assignment. Props: `visible`, `songId`, `songTitle`, `currentProfileId`, `onClose`, `onAssigned(profileName|null)`.

**`TextInputModal`**: cross-platform text input dialog (replaces iOS-only `Alert.prompt`). Use for any user text input (create/rename).

**UI primitives**: use `Pressable` (not `TouchableOpacity`) everywhere. `Pressable` style prop accepts a function `({ pressed }) => [...]` for press feedback.

**Playlist types**: two distinct kinds — `DailyPlaylist` (auto-generated by discovery, route `/playlist/[id]`) and `UserPlaylist` (user-created, route `/userplaylist/[id]`). Songs in `UserPlaylist` are stored as JSONB snapshots `{id, navidrome_id, title, artist, duration_sec}`.

**Library Artists tab**: two sections when active profile is not catchall — "Following" (top, artists with `followed=true`) and profile-name section (bottom, artists with songs assigned to this profile who are not followed). Built client-side: `getArtists({ followed: 'true' })` + `getArtists({ profile_id: activeProfileId })`, deduped by id. Refreshes via `useFocusEffect` on return from artist detail. Profile switch uses `!isCatchall` directly in the effect (not stale `filterProfile` state) to avoid a flash of wrong songs.

**`req<void>` and 204 responses**: `lib/api.ts`'s `req<T>` returns `undefined as T` for HTTP 204 responses instead of calling `r.json()`. All void endpoints (follow, unfollow, add artist, cancel download, etc.) return 204 — never return a JSON body from them or the client will silently fail.

**`isDaily: true`** is the gate for the skip-to-delete / listen-through-to-keep mechanic. Never apply to library or user playlists.

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

**Radial profile switcher**: long-press 280ms center home button → nodes appear in grid rows above anchor (max 3 per row, rows stack upward, `COL_GAP=104`, `ROW_GAP=100`). Slight seeded jitter per node for organic feel. Release on node to switch profile. Layout computed in `computeNodePositions()` in `RadialSwitcher.tsx`.

---

## Cover art

`getCoverUrl(navidrome_id)` from `lib/api.ts` returns `/api/v1/cover/{navidrome_id}`. For playlist cards on the home screen, use the first song's navidrome_id: `pl.songs?.find(s => s.navidrome_id)` then `getCoverUrl(song.navidrome_id)`.

---

## DB migrations

Migrations in `backend/alembic/versions/`. Current head: `0008` (download_profile_id). Add new migration file with `down_revision` pointing to current head, then run via the container exec pattern above.
