# HANDOVER.md — Session handoff (2026-06-12, updated after frontend batch landed)

**Read this first, then FIXPLAN.md.** You are picking up an in-progress repair of this app. The
audit is done, `FIXPLAN.md` is the master plan (every item has an ID), and the **entire mobile
frontend overhaul (Phase 2, MOB-1..18 + haptics) is implemented, typechecked clean, and committed**.
**Continue exactly where this file says; do not re-audit.**

## Operating context & constraints

- **You may NOT have LAN access to `10.1.8.4`** (backend, Portainer, Navidrome). If `curl http://10.1.8.4:8001/health` fails, you are in a cloud sandbox: do **code work only** (mobile + backend source, commits). Backend deploys/verification (Portainer tar-upload workflow in `CLAUDE.md`) must wait for a local session or Ben running commands. Mobile work is fully doable without LAN (code + typecheck; the APK build needs Ben's machine too).
- Git remote: `git@github-personal:sirBenhenry/musicplayer.git` (NEVER change to plain github.com — that maps to Ben's work account). Commit per logical batch, reference FIXPLAN IDs.
- Ben's decisions already made (don't re-ask): skip = next-press on daily playlists (no undo toast); web_search LLM hotfix dropped (DSC-6 optional, Claude-provider-gated); disk cleanup approved/done; priorities = everything; **UI style direction stays (terracotta/sage, Geist/InstrumentSerif tokens) — execution quality goes up**; every visible control must work; every feature needs UI; **add haptics for premium feel** (see below); offline downloads = FIXPLAN Phase 6 OFFLINE-1.
- Live-system facts you can't see from code: deployed container code is STALE vs repo (6 files, see FIXPLAN OPS-2); DB has 2,327 songs / 353 assigned (cleanup = CLN-9); 271 open notifications; host disk was full (fixed; prevention OPS-3/4 still TODO); NFS mount mismatch — never `docker compose up` (see FIXPLAN live-findings #6).

## State of the repo

### DONE & COMMITTED — mobile frontend (Phase 2 of FIXPLAN, MOB-1..18, typecheck clean)

All of the below plus: `mobile/lib/haptics.ts` created and wired (tabs, radial switcher, MiniPlayer
play/pause, FullPlayer seek/keep/shuffle, action-sheet delete warn, profile-assign success);
`playlist/[id].tsx` (4-arg playSong rows/playAll, shuffle wired), `userplaylist/[id].tsx` (null
playlistId + context), `artist/[id].tsx` (context), `deletion.tsx` (flat API shape), `settings.tsx`
(120s poll), `notifications.tsx` (badge math), `login.tsx` (expo-constants version), full
TouchableOpacity→Pressable sweep (zero remaining), dead `setQueue`/`appendToQueue` removed from
store.ts. NOT yet run on a device — APK build + manual pass is the verification gate (see debt below).

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

Work **one FIXPLAN item (or tight batch) at a time: implement → typecheck/verify → commit → push →
check off in FIXPLAN.md (` ✅ (date)` on the heading) → update this file**. That is Ben's standing
instruction.

1. **BE-1** — `GET /artists/{id}` 500 (missing `monitored` field). Code fix + deploy via Portainer
   tar-upload (CLAUDE.md workflow; LAN available).
2. **BE-2** — `jobs/eod.py` line ~312 `list | set` TypeError (kills artist prompts).
3. **BE-21** — `system-status` sync `os.walk` over NFS blocks the event loop (mobile half — 120s
   poll — already done).
4. **OPS-2** — redeploy ALL drifted files to the container (6 files listed in FIXPLAN OPS-2) so
   container == repo, then restart + smoke-test `/health`, `/artists/{id}`.
5. **OPS-3, BE-9, BE-10** — tmp janitor; library_sync must not delete songs on transient Navidrome
   errors; notification dedup (271 open).
6. **BE-3/4, SRC-2** — soulseek result-state + path fixes; retry cap.
7. Backend perf batch **BE-5/6/12/13/17**, then DSC/SRC batches, then CLN items (CLN-9 is
   interactive with Ben — never bulk-delete autonomously), then **Phase 6 OFFLINE-1**.
8. **APK build gate** (any time Ben wants to test the new frontend): `cd mobile/android &&
   ./gradlew assembleRelease` → bump `mobile/app.json` version → `gh release create` (MANDATORY)
   → `adb install`. Then the manual on-device pass per FIXPLAN verify steps for MOB-1..18.

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
