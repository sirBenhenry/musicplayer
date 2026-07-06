# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Self-hosted personal music streaming app. Single-user. Backend (FastAPI + PostgreSQL) on Docker host, Android app in `pixelplayer/` — a vendored GPLv3 fork of PixelPlayerOSS (Kotlin/Compose) integrated with the backend. The old React Native app in `mobile/` is SUPERSEDED — do not develop against it; it exists only as a feature/UX reference.

Core concept: **taste profiles** + **daily discovery playlists**. The backend generates 4 playlists per profile per day (close / broader / genre / artist slots) via LLM, downloads the songs through a multi-source pipeline, and the app plays them with a skip-to-delete / listen-through-to-keep mechanic processed at end of day (EOD).

---

## Network access

The server is reachable two ways — **always try Tailscale first**:

- **Tailscale (reliable)**: `100.92.64.70` (tailnet host `aniapp-server`). WSL's route to the LAN (10.1.8.0/24, via OpenVPN adapter) is frequently down; Tailscale works from anywhere. The phone is also on the tailnet (`nothing-phone-4a-pro`), so all client-facing URLs use the Tailscale IP.
- **LAN (when OpenVPN up)**: `10.1.8.4`.

Same ports on both: Portainer 9443, backend 8001, Navidrome 4533, qBittorrent 8080, Lidarr 8686, Prowlarr 9696, slskd 5030.

## Build & run

### Backend

No local Docker in the dev environment (WSL). All backend operations go through the Portainer API.

**Deploy changed Python files without rebuilding the image** (the normal workflow):
```bash
# Auth (JWTs expire — re-auth on 401)
TOKEN=$(curl -s -k -X POST https://100.92.64.70:9443/api/auth \
  -H 'Content-Type: application/json' \
  -d '{"username":"ben","password":"Passw0rd@docker"}' \
  | grep -o '"jwt":"[^"]*"' | cut -d'"' -f4)

CONTAINER_ID="f05355dcf876"  # music-backend

# Upload a file (tar per target dir; repeat per dir)
tar -cf /tmp/patch.tar -C backend/app/api playlists.py
curl -s -k -X PUT \
  "https://100.92.64.70:9443/api/endpoints/3/docker/containers/${CONTAINER_ID}/archive?path=/app/app/api" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/x-tar" \
  --data-binary @/tmp/patch.tar

# Restart
curl -s -k -X POST \
  "https://100.92.64.70:9443/api/endpoints/3/docker/containers/${CONTAINER_ID}/restart" \
  -H "Authorization: Bearer $TOKEN"
```

**Deploy modules as complete packages.** A refactor that changes a call signature must ship every file involved — deploying `discovery/pipeline.py` without its sibling generators once broke nightly generation for days (`generate() got an unexpected keyword argument`).

**Run a command in the container** (e.g. migration):
```bash
EXEC_ID=$(curl -s -k -X POST \
  "https://100.92.64.70:9443/api/endpoints/3/docker/containers/${CONTAINER_ID}/exec" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"Cmd":["alembic","upgrade","head"],"AttachStdout":true,"AttachStderr":true,"WorkingDir":"/app"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['Id'])")
curl -s -k -X POST \
  "https://100.92.64.70:9443/api/endpoints/3/docker/exec/${EXEC_ID}/start" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"Detach":false}'
```

For standalone Python scripts, add `"Env":["PYTHONPATH=/app"]` to the exec payload. Prefer `asyncpg` with raw SQL over the ORM in scripts — the ORM raises `NoReferencedTableError` unless ALL model modules are imported first.

**App credentials**: `admin` / `musicapp123` (backend login + Navidrome). DB: `postgresql://musicapp:musicapp_db_pass_2024@postgres:5432/musicapp`.

**Manual triggers**: `POST /api/v1/admin/sync` (library sync), `POST /api/v1/admin/generate` (daily generation), `POST /api/v1/admin/retry-downloads` — all need `Authorization: Bearer <app JWT>`.

### Android app (`pixelplayer/`)

Kotlin / Jetpack Compose / Material 3 / Hilt / Room / Media3. Requires **JDK 21** (`/usr/lib/jvm/java-21-openjdk-amd64`) and Android SDK platform **android-37.0** (installed in `/home/ben/android-sdk`; use `cmdline-tools/latest-2/bin/sdkmanager` — `latest` is too old for SDK 37 XML).

```bash
cd pixelplayer
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ANDROID_HOME=/home/ben/android-sdk

# Fast compile check (~2 min)
./gradlew :app:compileDebugKotlin -Ppixelplayer.enableAbiSplits=false --no-daemon -q

# Debug APK
./gradlew :app:assembleDebug -Ppixelplayer.enableAbiSplits=false --no-daemon

# Signed release (version via properties — no gradle file edits needed)
./gradlew :app:assembleRelease -Ppixelplayer.enableAbiSplits=false \
  -PAPP_VERSION_NAME=2.x.y -PAPP_VERSION_CODE=2xy --no-daemon
# → app/build/outputs/apk/release/app-release.apk (~45MB, R8-minified)
```

Signing: `pixelplayer/release.jks` + `keystore.properties` (git-ignored; backup in `~/.claude/projects/-home-ben-cliwrk-prj-musicplayer/`). **Every future release must use this keystore** or installs break.

**Release workflow** (after every accepted change — the in-app updater checks GitHub releases):
```bash
# Verify version baked into the APK before publishing
$(ls /home/ben/android-sdk/build-tools/*/aapt2 | tail -1) dump badging \
  pixelplayer/app/build/outputs/apk/release/app-release.apk | head -1

git add -A && git commit && git push origin main   # GPL: source must accompany the APK
gh release create v2.x.y pixelplayer/app/build/outputs/apk/release/app-release.apk \
  --title "..." --repo sirBenhenry/musicplayer --notes "..."
```
Bump `versionCode` every release — the phone caches stale downloads otherwise. Repo must stay public (updater + GPL compliance).

**License**: fork of `PixelPlayerHQ/PixelPlayerOSS` (GPLv3, upstream commit in `pixelplayer/UPSTREAM.md`). The 5k★ `PixelPlayerHQ/PixelPlayer` repo is PROPRIETARY — never pull from it.

---

## Infrastructure

```
Portainer: https://100.92.64.70:9443 (self-signed — always -k), endpoint ID 3
Credentials: ben / Passw0rd@docker
```

**musicapp stack** (`infra/docker-compose.yml`): `navidrome` :4533 (container `2c7960b5aee0`, busybox shell, NO Python, has sqlite3), `lidarr` :8686, `musicapp-postgres` (pg16 + pgvector, internal), `slskd` :5030 (liveness probe: `/api/v1/searches`; `/api/v1/application` 404s), `music-backend` :8001 (container `f05355dcf876`).

**Shared from aniapp stack**: qBittorrent :8080 (category `music`), Prowlarr :9696.

**NAS** (Synology 10.1.8.16): `:/volume2/streaming/musicapp` → `media/music/` (Navidrome library root) and `torrents/music/` (qBittorrent staging).

**Navidrome quirks**: no REST scanner API — rescan by restarting the container. `songs.file_path` in PostgreSQL is Navidrome's metadata-based virtual path, NOT the disk path; real paths live in `media_file` inside `/data/navidrome/navidrome.db`. `/data/music` is mounted in both `music-backend` and `navidrome` — write shell scripts there from the backend to exec in Navidrome.

## Git / SSH

```
git@github-personal:sirBenhenry/musicplayer.git
```
`github-personal` = personal account (`sirBenhenry`). Never switch to plain `github.com` (maps to the work account).

---

## Backend architecture

`backend/` — FastAPI, Python 3.12, SQLAlchemy async, Alembic, APScheduler. API prefix `/api/v1/`, single-user JWT auth.

```
app/
  api/          # Route handlers — one file per domain
  core/         # config, database, auth, scheduler, tasks (spawn())
  models/       # library.py (Artist/Album/Song), events.py (SongEvent, PendingDeletion,
                #   DownloadJob, UserNotification), discovery.py (DailyPlaylist), profile.py, playlists.py
  services/     # navidrome, lidarr, prowlarr, qbittorrent, download_pipeline (coordinator),
                #   scoring, sources/ (prowlarr|soulseek|youtube|archive|qobuz|spotdl),
                #   musicbrainz, mb_resolver, llm/ (deepseek default), essentia_svc
  discovery/    # pipeline.py (orchestrator), close_match, broader_taste, new_genre,
                #   artist_of_day, downloader
  jobs/         # library_sync, nightly, eod, download_poller, download_retry, playlist_health
```

**Background tasks**: NEVER bare `asyncio.create_task()` for fire-and-forget work — tasks get GC'd and downloads silently die. Use `core/tasks.py::spawn()` (keeps strong refs, logs crashes).

**Daily flow**: `DAILY_GENERATION_CRON` (02:00) → `run_nightly()` → EOD catch-up pass + `run_discovery()` → per profile with `daily_auto_generate`, LLM generates 4 slots → `queue_downloads()` (MB-resolves each track first, ≥1.1s apart). Generation policy: a slot is skipped while ANY unconsumed playlist exists for it (any date); unconsumed playlists >7 days old are expired (staged songs deleted). Nightly has hard timeouts (EOD 30min, discovery 3h) — a hung run otherwise silently cancels every following night via `max_instances=1`.

**Download pipeline** (`services/download_pipeline.py`): sources searched in parallel with per-source timeouts (soulseek 600s outer — it queues internally on its own Semaphore(4)); all candidates scored (`scoring.py`: identity 40 + quality 25 + source 15 + metadata 15 + cover 5; acceptable = identity ≥ 15; `pending_review` < 55); best downloaded, up to 5 fallback attempts. `_PIPELINE_SEM = Semaphore(4)`. Dedup at request time: active job → completed job w/ live file → `songs` table match (creates synthetic completed job). Prowlarr special case: `download()` queues a torrent and returns `(True, None)`; the 2-min poller handles completion, moves files, matches jobs by rapidfuzz. Stale rescues each poll: prowlarr torrents <1% after 1h, pipeline jobs stuck `downloading` >2h (by `pipeline_log[0].ts`), and jobs stuck `queued` >2h (lost task). Startup resets all `downloading|queued` → `failed` for the 15-min retry job.

**Staging → EOD loop** (the core mechanic): a song downloaded for a daily playlist gets `is_staged=True` AND its UUID + navidrome_id written into the `DailyPlaylist.songs` JSONB entry (matched by artist+title) — both in `_post_download_hook` and `download_poller`. EOD (`23:45` + 02:00 catch-up) reads only entries with `id`. close/broader slots: refill mode at ≥5 interactions (listened → assign to profile, skipped → delete file+row, holes refilled via LLM). genre/artist slots: prompt mode at ≥80% (creates `genre_prompt`/`artist_prompt` UserNotification; unplayed staged songs are deleted BY DESIGN). `flag_modified` lives in `sqlalchemy.orm.attributes` — importing it from `sqlalchemy.orm` raises ImportError and silently killed this entire loop once.

**Playback events** (`api/playback.py`): `POST /playback/progress|skip|listen-through`, body `{song_id, playlist_id?, progress_pct}`. Only daily playlists react: ≥90% progress → listen_through event; skip → PendingDeletion + 6-month RejectedSong ban.

**Library sync** (hourly): upserts Navidrome artists/albums/songs. Subsonic error code 70 on an artist = deleted in Navidrome → NOT counted as a fetch failure (counting it once deadlocked stale cleanup forever). Orphan albums/artists cleaned when a run has zero failures. httpx INFO logging is silenced in `main.py` — its request spam used to rotate the whole docker log in hours.

**Client config**: `GET /auth/client-config` returns Navidrome URL + credentials so the app configures its Subsonic account after one backend login. `NAVIDROME_PUBLIC_URL` in config.py must stay a client-reachable (Tailscale) URL, not the Docker-internal hostname.

**DB engine**: `pool_pre_ping` + `pool_recycle=1800` + connect/statement timeouts — a dead postgres connection once hung the nightly job for 3 days. Scheduler uses `coalesce` + `misfire_grace_time=3600`.

**LLM**: `LLM_PROVIDER=deepseek` (`DEEPSEEK_API_KEY` in env). Without a key generators return `[]` → no playlists.

**Migrations**: `backend/alembic/versions/`, current head `0016`. New migration → `down_revision` to head → exec `alembic upgrade head` in container.

---

## App architecture (`pixelplayer/`)

Package `com.lostf1sh.pixelplayeross` (kept from upstream; app label is "Music"). Upstream handles all playback/library natively via its Navidrome (Subsonic) client — our integration is additive under `data/backend/` and `presentation/`:

- **`data/backend/`** — `BackendApiService` (OkHttp + org.json, same pattern as `NavidromeApiService`; runtime session, all suspend), `BackendRepository` (EncryptedSharedPreferences session, transparent JWT refresh via `withAuthRetry`, active-profile StateFlow), `DiscoveryRepository` (today's slots resolved against Room via `navidrome_id` → playable `Song`s), `DailyPlaybackReporter` (skip/listen-through reporting; armed per-queue via `DiscoveryViewModel.armReporting()` before playing a daily slot), `UpdateChecker` (GitHub releases).
- **Two-account model**: user logs into the backend once (Settings → Accounts → Discovery Backend); the app pulls `/auth/client-config` and configures Navidrome automatically, sets **server-only mode** (`serverOnlyModeFlow` pref short-circuits the MediaStore fetch in `MediaStoreSongRepository` — phone-local files never appear) and enqueues a REBUILD sync.
- **EOD reporting hook**: `ListeningStatsTracker.finalizeCurrentSession(endedByTrackChange)` → `DailyPlaybackReporter.onSessionEnded()`. ≥90% position = listen-through; deliberate track change below that = skip. Pause/stop sends nothing.
- **Radial profile switcher** (`RadialProfileSwitcher.kt`): hold the Home nav tab → nodes spring out (bottom-up rows of 3, centred on screen — NOT on the anchor; the Home tab sits at the screen edge), drag + release selects. `RadialSwitcherController` singleton bridges the nav-item `pointerInput` (in `CustomNavigationBarItem`, `radialHooks`) to a fullscreen overlay mounted in `MainActivity`. Animation: uniform spring (dampingRatio 0.68, stiffness 520), 22ms stagger — read spring values ONLY inside `offset{}`/`graphicsLayer{}` lambdas (composition-phase reads caused visible jank). `releaseTick` must be reset in `open()` or the overlay closes instantly on reuse.
- **Home** (`DiscoveryDailySection.kt`): active-profile header (hue dot + name), Close Match as a Daily-Mix-style card (gradient header + `threeShapeSwitch` thumbnails + inline rows), Artist of the Day row, Broader/Genre tile pair. Replaces (hides) the local Your-Mix/Daily-Mix sections whenever the backend is connected.
- **Screens** (routes in `Screen.kt`, wired in `AppNavigation.kt`): `DailySlotScreen` (play/shuffle, pause-to-tomorrow, keep/delete flags, add-artist), `BackendDownloadsScreen` (retry/cancel/review + expandable pipeline log), `BackendNotificationsScreen` (prompts w/ profile picker, deletion rescue), `BackendSearchScreen` (MB tracks / Lidarr artists / Spotify-URL import), `BackendProfilesScreen` (CRUD), `BackendLoginScreen` (+ system status). Sidebar drawer has Find New Music / Downloads / Notifications.

**Design rules**: use PixelPlayer's visual recipes (`AbsoluteSmoothCornerShape`, Material 3 color roles, `SmartImage`, gradient headers) — never port old-app styling. No emoji anywhere; profile identity = `profileColor()` hue dot. Upstream's beta badge / changelog / streaming top-bar buttons and F-Droid links are removed — don't reintroduce upstream chrome when merging.

**Deferred (post-v2 backlog)**: auto-radio queue-end hook (`/queue/auto-radio-batch`), UserPlaylist→Navidrome playlist mirroring, per-profile library filtering, history screen, analysis monitor.
