# Music App — Import Guide

## 1. Spotify Playlist Import

Tap **Spotify** in the Library → Playlists tab header.

Paste any public Spotify share URL:
```
https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
https://open.spotify.com/album/3T4tUhGYeRNVUGevb0wThu
https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT
```

The app:
1. Fetches track metadata from Spotify (via spotDL — no Spotify account needed)
2. Creates a playlist with the Spotify name
3. Queues every track for download
4. Songs appear in the playlist automatically as each download completes

---

## 2. Bulk Song Import (`songs.json`)

Use this when you have a list of songs to download — e.g. from analysing your Spotify streaming history.

**File format:** JSON array. Save as `songs.json`.

```json
[
  { "artist": "Ado", "title": "唱" },
  { "artist": "Radiohead", "title": "Creep" },
  { "artist": "Portishead", "title": "Glory Box" },
  { "artist": "Massive Attack", "title": "Teardrop", "mb_recording_id": "f3a07d8f-9fb1-43cd-be2e-4e7f7a1e2f63" }
]
```

| Field | Required | Notes |
|-------|----------|-------|
| `artist` | Yes | Artist name |
| `title` | Yes | Track title — or use inline `mb:UUID` prefix (see below) |
| `mb_recording_id` | No | MusicBrainz recording MBID — improves matching accuracy. Get from musicbrainz.org |
| `profile` | No | Profile name (exact match). Assigns the song to that profile on download. Download the guide from the app to see current profile names. |

### Inline MB prefix in title

Instead of a separate `mb_recording_id` field, prefix the title with `mb:UUID`:

```json
[
  { "artist": "Ado", "title": "mb:c1c58f51-e516-4738-9f5b-b36eda2a87a2 唱" },
  { "artist": "Ado", "title": "mb:c1c58f51-e516-4738-9f5b-b36eda2a87a2" }
]
```

Both forms work:
- `mb:UUID Song Title` — uses UUID as recording ID, "Song Title" as search hint
- `mb:UUID` alone — uses UUID as recording ID, title fetched from MusicBrainz automatically

Same syntax works in the setup file `songs` and `playlists.songs` arrays.

In Settings → **IMPORT** → **Import songs** — pick the file. Shows "Queued N tracks" when done.

Duplicate tracks (already downloading or downloaded) are automatically skipped.

---

## 3. Full Setup File (`musicapp_setup.json`)

One file to set up everything: profiles, downloads, and playlists.

**File format:** JSON object. Save as `musicapp_setup.json`.

```json
{
  "profiles": [
    {
      "name": "Ben",
      "glyph": "🎵",
      "hue": 180,
      "description": "Main profile"
    },
    {
      "name": "Chill",
      "glyph": "🌿",
      "hue": 120
    }
  ],
  "artists": [
    {
      "name": "Ado",
      "mbid": "2f5c77dc-3470-4e07-b3b5-8b5ceac72aba",
      "follow": true,
      "download_recordings": false
    },
    {
      "name": "Radiohead",
      "mbid": "a74b1b7f-71a5-4011-9441-d0b5e4122711",
      "follow": true,
      "download_recordings": true
    }
  ],
  "songs": [
    { "artist": "Ado", "title": "唱" },
    { "artist": "Yoasobi", "title": "Idol" },
    { "artist": "King Gnu", "title": "Hakujitsu" }
  ],
  "playlists": [
    {
      "name": "Morning Vibes",
      "songs": [
        { "artist": "Nils Frahm", "title": "Says" },
        { "artist": "Ólafur Arnalds", "title": "Near Light" }
      ]
    },
    {
      "name": "J-Pop Favourites",
      "songs": [
        { "artist": "Ado", "title": "新時代" },
        { "artist": "Kenshi Yonezu", "title": "Lemon" }
      ]
    }
  ]
}
```

### Sections

**`profiles`** — Creates profiles that don't already exist (matched by name). Existing profiles are not modified.

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Profile name (case-sensitive) |
| `glyph` | No | Emoji shown in the profile switcher |
| `hue` | No | Accent hue (0–360) |
| `description` | No | Short description |

**`artists`** — Adds artists to Lidarr for monitoring and optionally follows them in the app.

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Artist name |
| `mbid` | Yes | MusicBrainz artist ID — find at [musicbrainz.org](https://musicbrainz.org/search?type=artist) |
| `follow` | No | `true` (default) — artist appears in your Library → Artists tab |
| `download_recordings` | No | `false` (default) — if `true`, queues every known recording for download immediately |

**`songs`** — Global song downloads, not tied to any playlist. Same format as the bulk songs file (supports `"profile"` field).

**`playlists`** — Creates a playlist and downloads all its songs. Songs are added to the playlist automatically as each download finishes. Playlist songs also support `"profile"` assignment.

All sections are optional — you can include only `artists`, only `songs`, only `playlists`, or any combination.

In Settings → **IMPORT** → **Import setup file** — pick the file.

---

## 4. Export Library + Apply Changes

Use this to reassign profile assignments or delete songs in bulk — with Claude's help.

### Step 1 — Export

Settings → **IMPORT** → **Export library**

Pick a folder (e.g. Downloads). Saves `musicapp_library_YYYY-MM-DD.json`:

```json
{
  "exported_at": "2026-05-28T12:00:00Z",
  "profiles": [
    {"id": "...", "name": "Japanese"},
    {"id": "...", "name": "Late Night"}
  ],
  "songs": [
    {"id": "abc123", "title": "唱", "artist": "Ado", "album": "うた", "profile": "Japanese"},
    {"id": "def456", "title": "Take Me to Church", "artist": "Hozier", "album": "Hozier", "profile": null}
  ]
}
```

### Step 2 — Edit with Claude

Upload the exported JSON to Claude and ask it to reassign profiles or mark songs for deletion.

Example prompt:
> "Here is my music library. Move anything that sounds cinematic or orchestral to the Cinematic profile. Delete any songs that have `profile: null` and seem mismatched. Return only an apply file."

Claude produces an apply file — a JSON object with a `songs` array:

```json
{
  "songs": [
    {"id": "abc123", "profile": "Cinematic"},
    {"id": "def456", "profile": null},
    {"id": "ghi789", "delete": true}
  ]
}
```

| Field | Effect |
|-------|--------|
| `"profile": "ProfileName"` | Reassigns song to that profile |
| `"profile": null` | Removes profile assignment (visible only in All Music) |
| `"delete": true` | Deletes the song file and removes it from the library |

Only songs listed in the apply file are touched. Unlisted songs are unchanged.

### Step 3 — Apply

Settings → **IMPORT** → **Apply library changes** → pick the Claude-produced JSON.

Shows: `X reassigned · Y deleted`. Any unknown profile names or missing song IDs are listed as warnings but don't block the rest.

---

## Tips

- **Japanese / non-Latin titles**: the download pipeline romanises titles automatically for matching, so `"唱"` and `"Uta"` both work.
- **MusicBrainz IDs**: adding `mb_recording_id` skips the search step and goes straight to the correct recording. Find IDs at [musicbrainz.org](https://musicbrainz.org).
- **Playlist songs appear gradually**: each track downloads independently. Open the playlist and pull to refresh to see new arrivals.
- **Duplicates**: any song already in the download queue or already downloaded is skipped — safe to re-import the same file.
- **Checking progress**: Settings → **Pipeline Activity** shows every download job and its status.

---

## Generating a songs.json from Spotify Data

Ask Claude with your Spotify `StreamingHistory_music_*.json` file:

> "Here is my Spotify streaming history. Give me a `songs.json` file containing every song I listened to more than 3 times, in the import format: JSON array of `{artist, title}` objects."

Claude will output a ready-to-use `songs.json`.
