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
