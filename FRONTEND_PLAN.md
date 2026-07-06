# Frontend Rebuild — PixelPlayerOSS Integration Plan

Working rule (user-set): **PixelPlayer-native first.** The old `mobile/` app is NOT the spec —
when PixelPlayer has an equivalent, tweak theirs. Custom builds only where no equivalent exists.

## Step 1 — PixelPlayerOSS analysis (DONE)

**Repo**: `PixelPlayerHQ/PixelPlayerOSS` (cloned → `pixelplayer/`), GPLv3 — modify + redistribute
freely; our fork must stay public-source (repo is public → compliant).
The 5.4k★ main `PixelPlayerHQ/PixelPlayer` is PROPRIETARY (no redistribution/derivatives) —
cannot be used: our GitHub-release update flow is redistribution. OSS edition only.

**Stack**: Kotlin, Jetpack Compose, Material 3 (dynamic color), Hilt DI, Room (schema-tracked),
DataStore prefs, Media3/ExoPlayer + FFmpeg, OkHttp-based API services, Glance widgets.
Build: JDK 21, compileSdk 37, minSdk 30. 460 Kotlin files.
Local toolchain gap: WSL has JDK 17 + platforms ≤36 → install temurin-21 + platform 37 before building.

**Architecture** (`app/src/main/java/com/lostf1sh/pixelplayeross/`):
- `data/` — Room entities/DAOs (Song/Album/Artist/Playlist/Favorites/Engagement/Lyrics/
  NavidromeSong/JellyfinSong + FTS search), repositories, `DailyMixManager` (engagement-scored
  local mixes), `SmartPlaylistBuilder`, backup, stats, media service, stream proxy
- `data/navidrome/NavidromeRepository.kt` (1094 lines) — full Subsonic client: login,
  folder selection, syncLibrarySongs, syncAllPlaylistsAndSongs, search, lyrics, scrobble,
  reportPlayback, unified-library merge (`syncUnifiedLibrarySongsFromNavidrome`)
- `presentation/` — Compose screens (Home/Search/Library/Settings + 30 more),
  sealed `Screen` routes, Hilt ViewModels
- Home already has `DailyMixSection` + `RecentlyPlayedSection`; `DailyMixScreen` route exists
- `NavidromeDashboard` screen for server account state

**Key insight**: PixelPlayerOSS already speaks Subsonic to OUR Navidrome — library sync,
streaming, artwork, playlists, scrobbling all native. Our backend stays the discovery/download
brain; the app talks to Navidrome for music and to our FastAPI for everything discovery.

## Step 2 — Feature audit (backend surface + old app) → mapping

Architecture decision: **two-account model.**
Music data path: PixelPlayer ←Subsonic→ Navidrome (native, untouched).
Discovery path: PixelPlayer ←REST→ FastAPI backend (`/api/v1/*`, JWT) — new thin client.
Setup: one screen collects backend URL + credentials; backend serves Navidrome creds
(admin/admin, LAN-only) so both accounts configure in one step.

### A. Keep native (PixelPlayer as-is — gains over old app)
| Feature | Note |
|---|---|
| Library browse/sort/search (albums/artists/genres/folders/FTS) | replaces old Library tab |
| Streaming, gapless, crossfade, transitions, EQ, sleep timer | Media3; old app was RNTP |
| Offline/local playback, external files | new capability |
| Covers + palette theming, dynamic color, light/dark | replaces terracotta/sage tokens |
| Navidrome playlist sync (two-way), favorites | replaces UserPlaylist screens |
| Lyrics (embedded/.lrc/LRCLIB), metadata editing, duplicates tool | new capabilities |
| Stats, recently played, widgets, backup/restore | new capabilities |
| Media notification / lock screen / Android Auto-ish surfaces | native Media3 session |

### B. Repurpose (native feature, our data)
| Feature | Plan |
|---|---|
| Daily playlists (4 slots/profile) | Replace `DailyMixSection` home carousel content with backend `/discovery/today` (per active profile). `DailyMixScreen` → slot playlist view (close/broader/genre/artist). Local `DailyMixManager` stays as fallback for offline. |
| Skip/listen-through mechanic (`isDaily`) | Media3 player listener: when queue source = daily playlist → POST `/playback/listen-through` at 90%, `/playback/skip` on manual skip, with playlist_id. Backend EOD does the rest (verified working). |
| Scrobble/progress | Native Navidrome scrobble stays; backend `/playback/progress` posted alongside only for daily-playlist tracks (feeds auto-radio recency). |
| User playlists | Navidrome playlists are source of truth in-app. Backend Spotify import keeps creating UserPlaylists → ALSO mirror to Navidrome playlist via Subsonic API (backend-side task) so they appear natively. |
| Genre/artist prompt actions | Notification screen actions call `/notifications/{id}/action` (assign songs / follow artist). |

### C. Build custom (no PixelPlayer equivalent)
| Feature | Plan |
|---|---|
| Taste profiles + switcher | Profile chips row on Home (replaces old radial gimmick — user called old UX ass). Active profile filters: daily playlists section, profile-filtered library view (map backend `songs.profile_id` ↔ Room songs via navidrome_id), auto-radio param. Profiles CRUD in settings. |
| Backend account setup | New Accounts entry: backend URL + login → stores JWT; auto-fills Navidrome account. |
| Downloads manager | Screen: `/downloads` list, retry/cancel/review actions, pipeline log detail. |
| Search-new-music | Extend SearchScreen with "Online" tab → `/tracks/search` + `/artists/search`, download buttons, discography import. |
| Notifications center | Screen for genre_prompt/artist_prompt/failed_to_fill + `/notifications/count` badge on Home. |
| Deletion rescue | Screen for `/deletion/pending` + rescue action. |
| Artist follow/add (Lidarr) | Buttons on ArtistDetail (match by name/mbid against backend `/artists`). |
| Auto-radio | Queue-end hook: when enabled + profile active → `/queue/auto-radio-batch` (map navidrome_id↔song). PixelPlayer shuffle stays as offline fallback. |
| In-app updater | Port old GitHub-releases check (tag vs BuildConfig.VERSION_NAME) into About/Settings. |

### D. Drop (dead weight from old app)
- Radial profile switcher, terracotta/sage token system, Geist fonts (Material 3 instead)
- `mobile/` app entirely (leave dir until new app ships, then delete)
- Old library stamp/cache layer (`libraryCache.ts`) — Room + Navidrome sync replaces
- Device-log shipper (`/admin/device-logs`) — keep endpoint, skip app UI (adb/logcat suffices)
- Analysis monitor screen → maybe simple status row in settings later (backend endpoint stays)
- History/redownload screen — backend endpoint stays; UI deferred (rarely used)

### E. Backend-side work this creates
1. Mirror UserPlaylists → Navidrome playlists (Subsonic createPlaylist/updatePlaylist) on import.
2. `/discovery/today` response: include navidrome_id per song (hook now writes it into JSONB ✓).
3. Endpoint serving Navidrome credentials to the app post-login (or embed in login response).
4. CORS/auth check for app origin (JWT already fine).

## Step 3 — Build order
1. Toolchain: JDK 21 + SDK 37 → stock `assembleDebug` must pass first.
2. Rebrand minimal: applicationId + app name (keep package internals; GPL notice in About).
3. `data/backend/` — BackendApiService (OkHttp+kotlinx-serialization), BackendRepository,
   DataStore-backed session (URL/JWT/active profile), Hilt module.
4. Accounts UI: backend login screen; wire Navidrome auto-setup.
5. Profiles: chips on Home + settings CRUD + active-profile state.
6. Daily playlists: home section swap + slot screen + play-queue wiring + event reporting.
7. Downloads / online search / notifications / deletion screens.
8. Auto-radio queue-end hook.
9. Updater port. 10. Release build, sideload, GitHub release v2.0.0.

Each step: compile + install on device before next.

---

# Audit v2 (2026-07-06) — post-first-install gap list

User feedback: profile switching invisible, phone-local music showing, de-brand needed,
old-app features missing. Full re-read of `mobile/` (10.5k lines) + backend API surface.

## Root causes of reported issues
1. **Local music appears**: PixelPlayer scans MediaStore by default. Native
   `StorageFilter.ONLINE` exists (persisted via `saveLastStorageFilter`) — never set.
   Also Home's local "Your Mix" collage + local DailyMix render from phone files.
2. **Profile switching unclear**: chips exist in DiscoveryDailySection but no
   "current profile" identity anywhere; local DailyMix sections drown the discovery
   section; no profile management UI at all (old app: profiles.tsx CRUD + ProfileMenu).

## Fix list v2.1 (all in this pass)
- [x] audit
- [x] SERVER-ONLY: set StorageFilter.ONLINE (persist) after backend login; hide local
      Your-Mix collage + local DailyMix sections whenever backend connected
- [x] PROFILE UX: discovery header shows active profile (glyph+name, hue accent);
      chips relabeled; gear → new BackendProfilesScreen (create/rename/delete via
      new POST/PUT/DELETE client methods; guard catchall)
- [x] DE-BRAND: app label → "Music" (old app name), remove F-Droid link/badge rows in
      About, source link → sirBenhenry/musicplayer, keep upstream GPL attribution
- [x] DailySlotScreen v2: pause-to-tomorrow, keep/delete flag badges (parse `flag`
      from enriched songs), duration display, artist-of-day "Add artist" button
- [x] Downloads v2: review actions (confirm / wrong_song / bad_quality) for
      pending_review + bad_quality jobs; expandable pipeline log (GET /downloads/{id}/pipeline)
- [x] Notifications: "Scheduled deletions" section (GET /deletion/pending + rescue)
- [x] Find New Music: Spotify playlist import (POST /playlists/import-spotify)
- [x] Backend status card (GET /admin/system-status): services health dots, NAS
      storage bar, library + download counters — on BackendLoginScreen connected view

## Feature-parity table vs old app (final disposition)
| Old-app feature | v2.1 state |
|---|---|
| Login / server URL | BackendLoginScreen ✓ |
| Profile switcher (radial) + ProfileMenu | chips + header identity + BackendProfilesScreen (this pass) |
| Profiles CRUD | BackendProfilesScreen (this pass) |
| Home: 4 daily slot cards | DiscoveryDailySection ✓ |
| Home: genre/artist prompt cards | Notifications screen ✓ (also badge later) |
| Home: new-release banner | DEFERRED (needs lidarr webhook artist flag surface) |
| Playlist detail: play/shuffle/hints | DailySlotScreen ✓ |
| Playlist detail: pause-to-tomorrow, flags, add-artist | this pass |
| Library songs/artists/playlists + profile filter | native PixelPlayer library (ONLINE filter) — per-profile library view DEFERRED (needs songs profile-map join) |
| Song actions: assign profile / delete / add-to-playlist | native playlist add ✓; profile assign + server delete DEFERRED |
| Search library | native ✓ |
| Search new music + download w/ profile | BackendSearchScreen ✓ (downloads to active profile) |
| Artist detail: follow/add/unfollow/download-all | partial via search screen; artist-detail buttons DEFERRED |
| Downloads: status groups, retry/cancel/review/pipeline log | this pass completes |
| Notifications center + dismiss-all + prompts | ✓ + deletions section this pass |
| Deletion rescue | this pass (in Notifications) |
| History + redownload | DEFERRED |
| Spotify import | this pass |
| Import songs/setup JSON, export/apply library | DROPPED from app (MCP/Claude Desktop path) |
| System status | this pass |
| Audio analysis monitor | DEFERRED |
| Device logs | DROPPED (adb) |
| In-app updater | ✓ |
| Auto-radio | DEFERRED (post-v2, needs queue-end hook) |
| Theme (terracotta/sage) | DROPPED — Material You covers it |

## v2.3 UX integration pass (2026-07-06 late morning)
Design rule applied: discovery UI rebuilt from PixelPlayer's own visual recipes, not old-app ports.
- Close Match = Daily-Mix card recipe: 80dp primary→tertiary gradient header, threeShapeSwitch
  thumbnails (star/circle/squircle), 4 inline song rows, "View all"+play footer
- Artist of the Day = compact row card (circular thumb, mono label, chevron)
- Broader/New Genre = half-width square tiles w/ cover + bottom scrim
- Profile switching = radial hold-Home gesture (RadialSwitcherController singleton bridges
  nav-item pointerInput → fullscreen overlay; nearest-node highlight, release commits);
  chips removed; header = hue dot + profile name + hint
- Emojis dead: profileColor(hue) dots everywhere (nodes = initials on hue circle)
- η mark removed (About hero + player placeholder → MusicNote icon)
- Server-only hardened: serverOnlyModeFlow pref gates MediaStore fetch entirely (folders fix),
  set on backend login + DB REBUILD sync enqueued so already-scanned local files vanish
