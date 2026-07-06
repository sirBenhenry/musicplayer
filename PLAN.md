# Rebuild Plan

## Task 1 — Understand codebase (status: DONE — see FINDINGS.md)
- Explore backend + current state (CLAUDE.md gives the map)
- Check live system: container logs, DB state, scheduler job history, download jobs, daily playlist rows
- Find what is actually broken vs what CLAUDE.md claims works
- Ask questions where unclear
- Deliverable: findings report of everything broken

## Task 2 — Fix backend (status: in progress)
- [x] Fix 7 broken `flag_modified` imports (root cause of dead EOD/staging loop)
- [x] Task registry (`core/tasks.py`) — no more GC'd fire-and-forget pipelines
- [x] Stale-`queued` rescue in poller (2h window, status-guarded)
- [x] DB resilience: pool_recycle, connect/statement timeouts
- [x] Scheduler: coalesce + misfire_grace_time; hard timeouts on nightly
- [x] Generation policy: unconsumed playlists block regeneration (any date); 7-day expiry
- [x] playlist_health scans capped to last 3 days
- [x] Library sync: Subsonic code 70 = gone (unblocks stale cleanup); orphan artist/album cleanup; httpx log spam silenced
- [x] FULL WIPE (user-approved): qBittorrent music torrents (245), Lidarr artists (260),
      DB data tables (7100 songs, 1271 playlists, 7242 jobs, `__temp__` profile), 157GB NAS files
- [x] Deployed via Portainer, backend + navidrome restarted
- [x] End-to-end verification COMPLETE (2026-07-06 00:20):
      download pipeline ✓ (soulseek FLAC, scored 83.5) · hook writes song id+navidrome_id
      into playlist JSONB ✓ · listen event → EOD assigns song, consumes playlist,
      creates genre_prompt notification ✓ · test data cleaned, system pristine
- Backlog (small, non-blocking): timed-out soulseek attempts leave orphan audio files
  in MUSIC_DIR (found 4 extra "One More Time" variants after 2 timeouts); api/admin.py
  one-shot create_task sites not yet routed through core/tasks.spawn; unused
  `_parse_uuid` helper sitting in api/playlists.py uncommitted diff

## Task 3 — New frontend: PixelPlayer (status: in progress)
Step 1 — Clone + analyze PixelPlayer (architecture, data layer, UI structure, licensing)
Step 2 — Full feature audit: every feature in backend + old `mobile/` app, each mapped to
         keep / drop / integrate differently / newly-gained-from-PixelPlayer.
         Goal: nothing silently lost. Small-breakage backlog folds into this audit
         (user can't recall individual breakages — audit re-derives them).
Step 3 — Build: hook PixelPlayer to FastAPI backend (auth, library, streaming, covers),
         repurpose its home playlist display for daily playlists, add taste-profile
         switcher. Old `mobile/` app abandoned.

## Rules
- After each task: report back, wait for explicit go before next task.
- Frontend rule: PixelPlayer-native first — tweak their features, don't port old app UX.

## HANDOFF STATE (2026-07-06 07:05 — machine shutdown, resume here)
Done: Task 2 complete + E2E verified. PixelPlayerOSS (GPLv3) cloned → `pixelplayer/`
(main PixelPlayer repo is proprietary — do NOT use). FRONTEND_PLAN.md = audit + build order.
Toolchain: JDK 21 (apt), SDK platform android-37.0 + updated cmdline-tools (`latest-2`) in
/home/ben/android-sdk. Stock `assembleDebug` PASSES (JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64,
local.properties written, -Ppixelplayer.enableAbiSplits=false).

New files so far (uncompiled since creation — compile first):
- pixelplayer/app/src/main/java/com/lostf1sh/pixelplayeross/data/backend/model/BackendModels.kt
- .../data/backend/BackendApiService.kt   (OkHttp+org.json client, all endpoints)
- .../data/backend/BackendRepository.kt   (EncryptedSharedPrefs session, JWT refresh,
                                           active-profile StateFlow, profiles cache)

Progress 2026-07-06 morning session (machine back up):
- Backend client layer compiles ✓
- Accounts integration: BACKEND service tile (enum+VM+cards+palette), BackendLoginScreen
  + route, all compiles ✓
- EOD-loop app half: DailyPlaybackReporter (@Singleton, armContext/clearContext,
  90% listen-through / deliberate-skip rules) hooked into ListeningStatsTracker.
  finalizeCurrentSession(endedByTrackChange) — compiles ✓
- Discovery surface: DiscoveryRepository (today + Room navidrome_id resolution),
  DiscoveryViewModel, DiscoveryDailySection (profile chips + 4 slot gradient cards),
  DailySlotScreen + daily_slot/{playlistId} route, HomeScreen integration
  (backend section replaces local DailyMix when slots exist) — compiling now
- Server 10.1.8.4 UNREACHABLE from WSL since reboot (route via 192.168.199.1/eth4
  VPN adapter down) — user must reconnect; nightly-generation check still pending
- Downloads screen (job list, retry/cancel) + Notifications screen (genre/artist
  prompt accept-into-profile / decline flows) + BackendSearchScreen (MB tracks +
  Lidarr artists, download / follow / discography) — all with routes + sidebar
  drawer entries (Find New Music / Downloads / Notifications) — compile clean
- Search client models corrected to real backend schemas (TrackSearchResult,
  ArtistSearchResult mbid/genres, /artists/import body)
- UpdateChecker (GitHub releases, sirBenhenry/musicplayer) + UpdateViewModel +
  About-screen check/download row
- UpdateChecker + About-screen row done; Navidrome one-login auto-config done:
  new backend endpoint GET /auth/client-config (auth.py + NAVIDROME_PUBLIC_URL in
  config.py — NOT DEPLOYED yet, server unreachable) + app pulls it after backend
  login and configures the native Subsonic account automatically
- Debug APK builds with everything: pixelplayer/app/build/outputs/apk/debug/app-debug.apk
- DEFERRED (post-v2.0): auto-radio queue-end hook (needs backend-UUID↔local song
  mapping inside MusicService queue-end; native shuffle suffices short-term);
  backend-side: mirror UserPlaylists→Navidrome playlists on import

RELEASED 2026-07-06 09:00 — v2.0.0 live:
- Server reachable via Tailscale: 100.92.64.70 (10.1.8.x route dead; OpenVPN
  adapter not connected — all tooling switched to Tailscale IP)
- Deployed: auth.py (client-config), config.py (NAVIDROME_PUBLIC_URL=tailscale),
  full discovery/ package (nightly had failed: container generators lacked the
  `candidates` kwarg — pipeline.py was deployed without its sibling refactor)
- Manual generation running: playlists + downloads flowing (verified live)
- Committed ae72d26 (backend overhaul + vendored fork, upstream e4537bf) + pushed
- gh release v2.0.0 with signed app-release.apk (45MB); keystore
  pixelplayer/release.jks + keystore.properties git-ignored, backed up in
  ~/.claude/projects/-home-ben-cliwrk-prj-musicplayer/
- NEXT: user sideloads + live-tests (login, auto-config, slots, keep/skip →
  tonight's EOD). Then post-v2.0 backlog: auto-radio hook, playlist mirroring,
  orphan-file cleanup on soulseek timeout, api/admin.py create_task→spawn

Next steps (FRONTEND_PLAN.md Step 3, continue at #4):
1. `./gradlew :app:compileDebugKotlin` — verify the 3 new files compile (check
   androidx.security dep exists in app/build.gradle.kts — NavidromeRepository uses it, so yes).
2. ~~Verify /playback/* body shapes~~ DONE 07:04: song_id/playlist_id/progress_pct match
   BackendApiService exactly (ListenBody has no progress_pct — client correctly omits).
   Still to verify: /tracks/search + /artists/search param name (q vs query), /downloads
   limit param, /notifications/{id}/action body shape.
3. Backend login screen (Accounts), profiles chips on Home, daily playlists section
   (swap DailyMixSection content), playback event reporting, downloads/notifications screens.
4. Check whether 02:00 nightly generated dailies for the 12 profiles on the wiped library
   (backend logs + daily_playlists table) — first real-world test of fixed loop.
5. Uncommitted backend fixes still in working tree — user hasn't asked to commit.
Wake-up lesson: session crons CANNOT survive usage-limit windows or shutdowns — don't rely on them.
