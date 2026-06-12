# HANDOVER.md — Session handoff (2026-06-12)

**Read this first, then FIXPLAN.md.** You are picking up an in-progress repair + UI-overhaul of this
app, mid-way through the **mobile frontend implementation session**. The previous session (Claude
Fable 5, local on Ben's machine with LAN access) did a full audit, wrote `FIXPLAN.md` (the master
plan — every item has an ID), revived the production system twice, and started implementing.
**Continue exactly where this file says; do not re-audit.**

## Operating context & constraints

- **You may NOT have LAN access to `10.1.8.4`** (backend, Portainer, Navidrome). If `curl http://10.1.8.4:8001/health` fails, you are in a cloud sandbox: do **code work only** (mobile + backend source, commits). Backend deploys/verification (Portainer tar-upload workflow in `CLAUDE.md`) must wait for a local session or Ben running commands. Mobile work is fully doable without LAN (code + typecheck; the APK build needs Ben's machine too).
- Git remote: `git@github-personal:sirBenhenry/musicplayer.git` (NEVER change to plain github.com — that maps to Ben's work account). Commit per logical batch, reference FIXPLAN IDs.
- Ben's decisions already made (don't re-ask): skip = next-press on daily playlists (no undo toast); web_search LLM hotfix dropped (DSC-6 optional, Claude-provider-gated); disk cleanup approved/done; priorities = everything; **UI style direction stays (terracotta/sage, Geist/InstrumentSerif tokens) — execution quality goes up**; every visible control must work; every feature needs UI; **add haptics for premium feel** (see below); offline downloads = FIXPLAN Phase 6 OFFLINE-1.
- Live-system facts you can't see from code: deployed container code is STALE vs repo (6 files, see FIXPLAN OPS-2); DB has 2,327 songs / 353 assigned (cleanup = CLN-9); 271 open notifications; host disk was full (fixed; prevention OPS-3/4 still TODO); NFS mount mismatch — never `docker compose up` (see FIXPLAN live-findings #6).

## State of the working tree (all UNCOMMITTED before this handoff commit)

### Done in this session — mobile frontend (Phase 2 of FIXPLAN), NOT yet typechecked or built

| File | What changed |
|---|---|
| `FIXPLAN.md` | Created (the master plan). Added BE-21 (event-loop freeze), CLN-9 (library cleanup), Phase 6 OFFLINE-1 (offline playback spec). |
| `mobile/lib/store.ts` | Added `radioScope` (+persist/hydrate), `repeatMode` state. |
| `mobile/lib/audio.ts` | **Full rewrite.** `playSong(song, url, playlistId, contextSongs?)` — context passed explicitly (MOB-1); only context songs get `playlistId` (MOB-4); `reportSkipIfDaily()` exported + called in `skipToNext` (MOB-2); all queue ops id-based via `rnptIndexOf`/`syncQueueMirror` — `addToQueue`, `removeFromExplicitQueue`, `moveInExplicitQueue`, new `removeAutoSong` (MOB-3); `cycleRepeatMode()`, `shuffleUpcoming()` (MOB-5 backend); `togglePlay` uses `getPlaybackState()` (MOB-17); `fillAutoQueue` respects `radioScope`. |
| `mobile/lib/PlaybackService.ts` | `RemoteNext` calls `reportSkipIfDaily()` before skipping (MOB-2). |
| `mobile/lib/api.ts` | Errors surface backend `detail` (MOB-13); removed dead `getAutoRadio`/`getQueue`/`appendQueue` (CLN-2). |
| `mobile/lib/tokens.ts` | Added `success`/`danger`/`warning` to light+dark themes (CLN-3). |
| `mobile/components/player/Waveform.tsx` | Optional `width` prop → bar count derives from it (full-player use). |
| `mobile/components/player/FullPlayer.tsx` | **Full rewrite (MOB-5).** Shuffle→`shuffleUpcoming`, repeat cycle w/ "1" dot, heart = daily-keep via `flagSong` (hidden for non-daily), dots → `SongActionSheet` (+Playlist/ProfilePicker modals, delete skips next), waveform as seek bar, Stay/Open toggle wired to `radioScope`, up-next row opens queue sheet. |
| `mobile/components/player/QueueSheet.tsx` | "FROM PLAYLIST" section (upcoming context songs, MOB-11); auto-removal id-based via `removeAutoSong`; updated empty copy. |
| `mobile/components/shared/SongActionSheet.tsx` | `theme.danger` tokens; optional `onPlayNext` row added. |
| `mobile/components/shared/ProfilePickerModal.tsx` | Optional `noneLabel` prop. |
| `mobile/components/profile/ProfileMenu.tsx` | **Full rewrite (MOB-15).** `hsl()` avatar (oklch was invalid in RN), Icon-set icons, Pressable, **new "Pending deletions" menu entry** (deletion screen previously unreachable!). Exports `profileHue()`. |
| `mobile/app/(tabs)/index.tsx` | **Full rewrite (MOB-8/10/12-adjacent).** `useFocusEffect` + pull-to-refresh; notification bell + badge in header → `/notifications`; genre-prompt accept opens ProfilePickerModal (`noneLabel="Create new profile…"` → TextInputModal) — no more iOS-only `Alert.prompt`; `playFirst` passes context songs (MOB-1); artist/genre card titles read the `_artist_of_day`/`_genre` markers. |
| `mobile/app/(tabs)/library.tsx` | Slot labels fixed (MOB-9); stamp-fail = no refetch (MOB-12); daily+user playlists refresh on focus (CLN-4); song tap passes context (MOB-1); imported `addToQueue` (wiring still TODO below). |

### IMMEDIATE NEXT STEPS (in order — start here)

1. **Typecheck everything just written** (nothing has been verified):
   `cd mobile && npx tsc --noEmit` — fix all errors. Likely suspects: unused imports left in
   `library.tsx`/`QueueSheet.tsx` (e.g. `SectionList`, possibly `useStore` usages), prop mismatches in
   `FullPlayer.tsx` against `PlaylistPickerModal` (its props: visible, songId, songTitle, onClose,
   onAdded(name)), `Icon` name typing (`IconName` exported from `components/shared/Icon.tsx`; valid
   names listed in CLAUDE.md — `notification` exists).
2. **`library.tsx`: wire "Play next"** — pass `onPlayNext` to its `<SongActionSheet>`: find the full
   song in `displaySongs` by `actionSong.id` and call `addToQueue(song)`. (Import already added.)
3. **`mobile/app/playlist/[id].tsx`** — (a) row tap + `playAll`: switch to
   `playSong(song, url, id, contextSongs)` per new signature, delete the manual
   `useStore.getState().setQueue(...)` calls; (b) **wire the dead shuffle button** (MOB-6):
   Fisher-Yates `playableSongs` → `playSong(shuffled[0], getStreamUrl(...), id, shuffled)`.
4. **`mobile/app/userplaylist/[id].tsx`** — pass context songs (filter `navidrome_id`), **change
   playlistId arg to `null`** (currently passes the UserPlaylist id — pollutes daily mechanics,
   MOB-4); TouchableOpacity→Pressable.
5. **`mobile/app/artist/[id].tsx`** — pass context songs to `playSong`; TouchableOpacity→Pressable.
6. **`mobile/app/deletion.tsx`** — MOB-7: API returns FLAT `{song_id, title, artist_name, marked_at}`
   — render `item.title`/`item.artist_name` (not `item.song?.…`), `keyExtractor={(p) => p.song_id}`.
   Also add `useFocusEffect` reload + empty-state polish.
7. **`mobile/app/settings.tsx`** — system-status poll 30s→120s (BE-21 mobile half, line ~39);
   TouchableOpacity→Pressable sweep.
8. **`mobile/app/notifications.tsx`** — MOB-16 badge math (recompute count from updated list inside
   the setState); Pressable sweep.
9. **`mobile/app/login.tsx`** — MOB-14: version from `expo-constants` (`Constants.expoConfig?.version`),
   not hardcoded `v1.0.0-b9`; Pressable sweep.
10. **`mobile/app/downloads.tsx`, `history.tsx`, `_layout.tsx` ErrorBoundary** — Pressable sweep
    (MOB-18). Use unified header pattern (mono label + heading) where trivial.
11. **HAPTICS (Ben explicitly wants this — "premium feel").** Check `mobile/package.json` for
    `expo-haptics`; if missing: `npm install expo-haptics` (bare workflow — autolinks on next gradle
    build, no config needed). Create `mobile/lib/haptics.ts`:
    ```ts
    import * as Haptics from 'expo-haptics';
    export const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    export const press = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    export const success = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    export const warn = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    export const selection = () => Haptics.selectionAsync().catch(() => {});
    ```
    Wire: `tap()` on play/pause + mini-player play + skip prev/next; `selection()` on tab switches,
    radial-switcher hover change (`updateHover` in `(tabs)/_layout.tsx` when hoveredId changes — it
    already tracks changes), seek release, filter chips; `press()` on long-press sheet/action-sheet
    open and radial open (`openRadial`); `success()` on keep-heart, flag keep, profile assigned,
    download queued, playlist created; `warn()` on delete confirms and skip-marked-for-deletion.
    Keep it tasteful — interactions, not scrolls.
12. **Final pass:** `npx tsc --noEmit` clean → commit (`MOB-* frontend overhaul batch 1`) → push.
13. **Then continue with FIXPLAN implementation order step 1** (backend: BE-1, BE-2, BE-21 →
    OPS-2 redeploy — needs LAN; if cloud, do the code edits + commit, leave deploy to a local
    session and note it in this file under "Pending deploy").
14. After backend code lands: remaining FIXPLAN phases in the listed order; check items off in
    FIXPLAN.md by appending ` ✅ (date)` to the item heading when implemented (and note "deployed"
    separately when actually shipped to the container/APK).

### Verification debt (cannot be done in cloud — needs Ben or local session)
- Nothing implemented this session has run on a device. After typecheck+build: full manual pass per
  FIXPLAN verify steps for MOB-1..5, 7..17 (wrong-song bug, skip-to-delete, queue ops, dead controls).
- APK build: `cd mobile/android && ./gradlew assembleRelease` → bump `mobile/app.json` version →
  `gh release create vX.Y.Z <apk> --repo sirBenhenry/musicplayer` (MANDATORY per CLAUDE.md).
- Backend: 123-job queued backlog + 271 notifications still pending their FIXPLAN fixes (SRC-2, BE-10).

### Gotchas discovered (don't re-learn these)
- `mobile/index.js` uses `require()` ordering — PlaybackService registers before React mounts;
  `PlaybackService.ts` now imports from `audio.ts` (safe: no React deps at module top level, no
  circular import — audio.ts does not import PlaybackService).
- RNTP custom track fields used everywhere: `songId`, `navidromeId`, `playlistId` — `playlistId`
  non-null ⇔ track belongs to a DAILY playlist (this is the skip-mechanic gate; never set it for
  user playlists or library).
- `store.setQueue`/`appendToQueue` may now be unused after the audio.ts rewrite — if tsc/grep
  confirms, delete them from store.ts.
- Old `QueueSheet` arithmetic and old `playSong` are gone — if you see merge artifacts referring to
  `setAutoQueue` inside QueueSheet or `insertAt` math in audio.ts, that's stale code, remove.
- Portainer exec output is corrupted by stream-frame headers — for reliable container reads, write
  to a file in the container and download via the archive endpoint (memory note exists locally;
  repeated here because cloud has no memory access).
- Backend creds: app `admin`/`musicapp123`; Portainer `ben`/`Passw0rd@docker`, endpoint 3, container
  `f05355dcf876`. Backend `http://10.1.8.4:8001`.

## Where everything lives
- **FIXPLAN.md** — every bug/feature, exact instructions, verify steps, implementation order.
- **CLAUDE.md** — environment, deploy workflows, architecture reference (mostly accurate; FIXPLAN
  supersedes it where they conflict).
- **This file** — session state. KEEP IT UPDATED: when you finish the steps above, rewrite the
  "IMMEDIATE NEXT STEPS" section to reflect the new frontier before ending your session.
