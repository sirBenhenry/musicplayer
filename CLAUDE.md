# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Design-only phase. No production code exists yet. `music-app/` is a read-only design handoff bundle from claude.ai/design — treat it as the visual spec, not the implementation target.

Authoritative references:
- `music-app/project/uploads/music_app_features.md` — full feature spec (what to build)
- `music-app/chats/chat1.md` — design iteration transcript (why things look the way they do)
- `music-app/project/styles.css` — all design tokens, spacing rules, animation specs
- `music-app/project/app.jsx` — navigation model and state shape

## Infrastructure — Docker via Portainer

All services run in Docker, managed through Portainer API (no direct socket access).

```
Base:        https://10.1.8.4:9443
Endpoint ID: 3
Docker API:  https://10.1.8.4:9443/api/endpoints/3/docker/...
Credentials: ben / Passw0rd@docker
```

**Auth — get JWT first, use on every call:**

```bash
TOKEN=$(curl -s -k -X POST https://10.1.8.4:9443/api/auth \
  -H 'Content-Type: application/json' \
  -d '{"username":"ben","password":"Passw0rd@docker"}' \
  | grep -o '"jwt":"[^"]*"' | cut -d'"' -f4)

# All Docker calls:
curl -s -k "https://10.1.8.4:9443/api/endpoints/3/docker/..." \
  -H "Authorization: Bearer $TOKEN"
```

Always use `-k` (self-signed cert). Always re-auth if you get a 401 — JWTs expire.

## Docker stack layout

**aniapp stack** (existing) — anime/movies + shared download infrastructure:
- `sonarr` :8989, `radarr` :7878, `qbittorrent` :8080, `prowlarr` :9696, `jellyfin` :8096
- All share Docker volume `aniapp_anime_data` → NFS `10.1.8.16:/volume2/streaming/aniapp`
- qBittorrent also mounts `musicapp_music_data:/data/music` (after migration)

**musicapp stack** (`infra/docker-compose.yml`) — this project:
- `navidrome` :4533 — Subsonic-compatible music server
- `lidarr` :8686 — artist monitoring + new release downloads
- `musicapp-postgres` — PostgreSQL 16 + pgvector, internal only
- `music-backend` :8000 — FastAPI custom backend (built from `backend/`)
- Shared volume `musicapp_music_data` → NFS `10.1.8.16:/volume2/streaming/musicapp`

**Shared services** (aniapp, accessed by musicapp via host IP):
- qBittorrent: `http://10.1.8.4:8080`
- Prowlarr: `http://10.1.8.4:9696`

**NAS** — Synology at `10.1.8.16`:
- `:/volume2/streaming/aniapp` — anime/movie media + torrents
- `:/volume2/streaming/musicapp` — music library + staging
  - `media/music/` — final library (Navidrome + Lidarr root folder)
  - `torrents/music/` — qBittorrent download staging (Lidarr import source)

**Path contract** (both qBittorrent and Lidarr must agree):
- qBittorrent: category `music` saves to `/data/music/torrents/music`
- Lidarr: root folder `/data/music/media/music`, download client path `/data/music/torrents/music`
- music-backend: `MUSIC_DIR=/data/music/media/music`, `DOWNLOADS_DIR=/data/music/torrents/music`

## Deploying the musicapp stack

```bash
cd infra/
cp .env.example .env   # fill in all required values
docker compose -p musicapp up -d
```

The `musicapp_music_data` NFS volume must be created before aniapp can reference it as external.
See `aniapp/MIGRATION_STREAMING.md` for the aniapp-side changes needed.

## Updating the codebase

```bash
./update.sh          # git pull + reinstall deps (if any)
./update.sh branch   # pull a specific branch
```

## Git / SSH

Personal account (`sirBenhenry`) uses the `github-personal` SSH host alias:

```
git@github-personal:sirBenhenry/musicplayer.git
```

The default `git@github.com` maps to the work account (`im25a-gonnetb`). Never change the remote URL to plain `github.com` for this repo.

## Design system (from prototype — implement faithfully)

**Typography:**
- UI text: `Geist`, feature flags `"ss01", "cv11"`, `letter-spacing: -0.005em`
- Display headings: `Instrument Serif` (serif class), `letter-spacing: -0.01em`
- Labels/timestamps: `Geist Mono` (mono/label classes), uppercase, `letter-spacing: 0.12em`

**Color tokens** (all via CSS vars — never hardcode):
- Light base: `--bg: #f4ede2`, `--fg: #1f1a14`
- Dark base: `--bg: #181512`, `--fg: #ede5d8`
- Two accent themes: terracotta (default) and sage — applied via `.accent-sage` class on root
- Theme applied as `theme-light`/`theme-dark` + `accent-terra`/`accent-sage` on the root element

**Key radii:** 10px (covers), 14px (cards/mini-player/sheets), 18px (radial petals), 100px (pills/buttons)

**Shadows:** always warm-tinted (`rgba(40, 25, 15, …)` light / `rgba(0,0,0,…)` dark), soft multi-layer

## Navigation model (from prototype)

Stack-based: `[{ screen, ...params }]`. Three root tabs (search / home / library) each reset the stack. Pushing navigates forward; popping goes back. Sub-screens like `playlist`, `artist`, `history`, `settings`, `deletion` push onto the stack and carry their data as params.

The full-screen player (`PlayerScreen`) is a separate overlay, not in the stack. Profile menu is also a sheet overlay.

## Core data shapes

```js
Song:    { id, title, artist, album, duration (seconds), cover: { kind, seed }, profile }
Profile: { id, name, desc, hue, songs, glyph }
Artist:  { id, name, followed, newRelease, songs, photo: { kind, seed } }
Playlist: { id, title, songs[], isDaily (bool), slot, duration, cover }
```

`isDaily: true` is the gate for the skip-to-delete / listen-through-to-keep mechanic. Never apply that mechanic to library or custom playlists.

## Mini-player → full player transition

The morph animation must originate from the mini-player's exact rect: `bottom: 72px` (nav height), `left/right: 8px`, `height: 60px`, `border-radius: 14px`. The sheet expands from there to full-screen. See `sheetMorph` / `sheetMorphOut` keyframes in `styles.css` for the exact spec.

## Waveform scrubber

SVG-based, 54 bars × 1.5px wide, 1.5px gaps. Played bars: `--accent` at 85–100% opacity. Unplayed: `--fg-soft` at 32% opacity. Heights are a 3-bar moving average (smoothed), floor at 40%. Bars use `rx` rounding.

## Radial profile switcher

Long-press (280ms) the center home button. Petals fan out in an arc above the button; drag to a petal to focus it (scale 1.08, accent fill), release to commit. Coordinates are app-root–relative, not viewport. Five profiles, upper hemisphere arc. See `profile-switcher.jsx` for geometry.
