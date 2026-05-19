# Music App — Backend Feature Layout

## What is this?

A self-hosted personal music streaming backend. All music lives on a personal server. The backend handles library management, multi-device streaming, artist monitoring, automated music discovery through daily playlist generation, acoustic similarity matching, and a taste profile system. The discovery system is the core differentiator — it runs nightly, generates personalised playlists using a combination of acoustic analysis, external music databases, and an LLM, and manages a full lifecycle of skip/keep/delete for every recommended song.

---

## Core Server & Streaming

### Music Server
**What it is:** The central service that stores and serves the music library. Handles all streaming to connected clients.
**What we use:** Navidrome — a self-hosted music server with a Subsonic-compatible API, multi-user support, and a clean web interface. All clients (phone, desktop, web) connect through the Subsonic API.

### Multi-User Accounts
**What it is:** Multiple users can have their own library, playlists, taste profiles, and discovery settings on the same server instance.
**What we use:** Navidrome's built-in user management.

### Client Endpoints
**What it is:** The server exposes a Subsonic-compatible API that any compatible client can connect to. Phone app, desktop app, and web interface all talk to the same backend.
**What we use:** Subsonic API protocol via Navidrome.

---

## Library Management

### Song Storage
**What it is:** All music files live on the server in an organised directory structure. The server scans the directory and builds the library from the files it finds.
**What we use:** Local filesystem, Navidrome library scanning.

### Artist Following & Release Monitoring
**What it is:** Users can follow artists. The backend monitors those artists for new releases. When something new drops, it gets automatically downloaded and added to the library, then surfaced as a notification to the user.
**What we use:** Lidarr — handles artist monitoring, release detection, and triggers downloads automatically. Integrates with download clients the user already has set up.

### Download Client Integration
**What it is:** The layer that actually fetches audio files when Lidarr or the discovery system requests them.
**What we use:** Standard torrent or download client already in use (same infrastructure as the anime/movie setup).

### Metadata Management
**What it is:** Every song needs correct metadata — title, artist, album, genre, year, cover art. This is used for display, search, and feeding into the recommendation algorithm.
**What we use:** Lidarr handles metadata on download. Navidrome reads and stores it.

---

## Taste Profiles

### Profile Storage
**What it is:** Each user can have multiple named taste profiles. Each profile represents a distinct side of their music taste. One profile is designated as the unspecified catch-all.
**What we use:** Custom database table storing profiles per user, with one field flagging which is the catch-all.

### Song-to-Profile Assignment
**What it is:** Every song in the library can be assigned to one profile. This assignment is used by the auto-radio engine and the discovery system to keep recommendations contextually relevant.
**What we use:** Custom field on the song record in the database, linking it to a profile ID.

### Auto-Assignment
**What it is:** When a new song is added without a manual profile assignment, the backend analyses the song and tries to assign it to the most fitting profile by comparing its acoustic features against the acoustic fingerprints of existing profiles.
**What we use:** Essentia acoustic feature vectors for comparison. The system computes a confidence score per profile.

### Uncertain Assignment — Popup Trigger
**What it is:** If the confidence difference between the top two candidate profiles is below a defined threshold, instead of silently picking one, the backend flags the song as unassigned and sends a notification to the client prompting the user to manually assign it.
**What we use:** Custom confidence threshold logic. Notification via the client API.

---

## Daily Discovery System

The discovery system is the core of the app. It runs overnight, generates four playlists per active taste profile, downloads the songs, and presents them to the user the next day. The whole system is built around a passive skip/keep mechanic and three internal tracking lists.

---

### The Three Tracking Lists

**Library List**
**What it is:** A complete list of every song currently in the user's library. The recommendation engine checks against this list to ensure it never recommends something the user already owns.

**Rejected Songs List**
**What it is:** Every song that has been recommended and then skipped (rejected) is logged here with a timestamp. The recommendation engine checks against this list to avoid re-recommending rejected songs. Entries expire after six months, after which the song can be recommended again.

**Genre History List**
**What it is:** A log of every genre used for Playlist 3 (New Genre) in order. The recommendation engine checks this to avoid repeating the same genre too soon. The LLM uses this list as context when selecting the next genre.

---

### Nightly Playlist Generation — Cron Job
**What it is:** A scheduled job that runs every night. For each user and each profile marked for daily generation, it triggers the full playlist generation pipeline — querying external services, running the LLM, selecting songs, downloading them, and writing the playlists to the server ready for the next day.
**What we use:** Cron job or task scheduler. Runs during the night when the server is otherwise idle.

### Playlist 1 — Close Match Generation
**What it is:** Finds new songs and artists that are acoustically and stylistically very close to the user's existing taste within a specific profile. The goal is niche discovery — artists the user has never heard of but would immediately connect with.
**What we use:** Last.fm and ListenBrainz APIs to traverse the similar-artist graph starting from artists in the profile. Results filtered against the Library List and Rejected Songs List. LLM used to reason over the candidates and select the final tracklist.

### Playlist 2 — Broader Taste Generation
**What it is:** Finds songs that fit the user's general taste but push slightly further out. More experimental than Playlist 1 but still anchored to the profile.
**What we use:** Same stack as Playlist 1 but with a wider radius on the similarity graph traversal. LLM selects final songs with a brief to be slightly adventurous.

### Playlist 3 — New Genre Generation
**What it is:** Selects a genre the user hasn't been introduced to recently (checked against the Genre History List), then curates a strong introductory playlist in that genre. Every day this slot is a completely different genre.
**What we use:** Genre History List fed to the LLM as context. LLM selects the genre and then, combined with web search access, curates a representative playlist of good songs in that genre. Genre logged to the Genre History List after generation.

### Playlist 4 — Artist of the Day Generation
**What it is:** Selects a single new artist the user is likely to enjoy and builds a short introductory playlist from only that artist's songs.
**What we use:** Similar-artist graph from Last.fm/ListenBrainz. LLM reasons over candidates to pick the most interesting match. Songs filtered against Library List and Rejected Songs List.

### LLM Integration
**What it is:** The LLM is the reasoning layer on top of all the data. It receives the user's listening history, profile contents, similar artist data from external APIs, the rejected list, the genre history, and web search results. It reasons over all of this to make final playlist selections. It does not need to know the songs from memory — it works from the data it is fed.
**What we use:** Claude API during the initial phase before the local LLM setup is complete. Switches to the local LLM (AMD GPU, 32GB VRAM) once that is running. The LLM also has web search access to find niche artists and forum discussions.

### External Music Data APIs
**What it is:** Data sources that provide artist similarity graphs, community tags, and listening data. These feed the LLM with structured information about which artists and songs are similar to what the user already likes.
**What we use:** Last.fm API and ListenBrainz API. Both have similar-artist data and community tagging, with ListenBrainz being particularly strong for niche artists.

### Song Download for Discovery Playlists
**What it is:** Once the LLM has selected the songs for all four playlists, the backend downloads them to the server overnight so they are ready to stream the next morning.
**What we use:** Same download infrastructure as the rest of the library.

### LLM Profile Assignment for Discovery Songs
**What it is:** When the LLM generates a discovery playlist, it already knows which profile and what reasoning led to each song pick. It assigns the profile tag to each song at generation time so no separate auto-assignment step is needed for discovery songs.

---

## Skip / Keep / Delete Lifecycle

### Skip Detection & Real-Time Pending Deletion View
**What it is:** When a user skips a song in a daily discovery playlist, the client reports this event to the backend immediately. The backend marks that song as pending deletion and logs it to the Rejected Songs List with a timestamp. At any point during the day, if the user opens that daily playlist, they can see which songs are currently marked for deletion — these are visually flagged. The user can tap any flagged song to unmark it (rescue it) or tap any kept song to manually mark it for deletion. This give full manual control over the deletion state of every song in the playlist at any time of day, not just at the end.

### Listen-Through Detection
**What it is:** When a user listens to a song all the way through in a discovery playlist, the backend marks it as kept and moves it permanently into the library. No user action required.

### Half-Listened Detection
**What it is:** If the user stops listening to a daily playlist partway through, the remaining unplayed songs are marked as neither kept nor rejected. They are not added to the library and not added to the Rejected Songs List, meaning they can be recommended again in the future.

### End of Day Batch Processing
**What it is:** Once per day, before the nightly generation job runs, the backend processes all pending deletions. Songs marked for deletion are permanently removed from the server. This is also the window during which the user can review and rescue songs before they are deleted.

### Pause to Tomorrow
**What it is:** A user can defer any of the four daily playlists to the next day. The backend stores a flag on that playlist. The nightly generation job checks this flag and skips regenerating that playlist slot, leaving the existing one in place for another day.

---

## Acoustic Similarity Engine

### Audio Feature Extraction
**What it is:** When a new song is added to the library, the backend analyses the audio file and extracts a set of acoustic features — tempo, key, mood, timbre, energy, and more — and stores them as a feature vector.
**What we use:** Essentia — an open source audio analysis library that runs fully locally. No external API needed.

### Similarity Index
**What it is:** A searchable index of all acoustic feature vectors in the library. When the auto-radio needs to find the next song, it queries this index for the nearest neighbours to the currently playing song.
**What we use:** Essentia feature vectors stored in a local vector index. Updated whenever new songs are added.

### Auto-Radio / Next Song Prediction
**What it is:** When a song ends, the backend finds the most acoustically similar song in the library (or within the active profile) and queues it automatically. Matching is based on actual sound — vibe, tempo, mood — not genre tags or metadata.
**What we use:** Nearest-neighbour query on the Essentia similarity index. Profile-aware — searches within the active profile by default, full library if the toggle is on.

### Profile Acoustic Fingerprint
**What it is:** Each taste profile has an aggregate acoustic fingerprint derived from all the songs assigned to it. This is used for auto-assignment confidence scoring when new songs are added.
**What we use:** Average or centroid of the Essentia feature vectors of all songs in the profile.

---

## Discovery History

### 30-Day Playlist Log
**What it is:** Every daily playlist generated in the past 30 days is stored as a text record — song titles, artists, and which slot it was (Playlist 1–4). No audio is stored, just the tracklist. Older entries are automatically purged.

### Re-Download from History
**What it is:** A user can select any playlist from the history log and trigger a re-download of its songs. This is for cases where a song was skipped but the user wants to give it another listen. The re-downloaded songs go through the normal skip/keep lifecycle again.

---

## Scrobbling & Listening History

### Scrobbling
**What it is:** Every song played is logged with a timestamp. This listening history is the primary data source for the recommendation engine over time — the more you listen, the better the system knows your taste.
**What we use:** ListenBrainz for open source scrobbling. Optionally Last.fm in parallel.

---

## Playback Queue

### Queue System
**What it is:** A session-based playback queue that works like Spotify's queue. At any point the user can add any song, album, or playlist to the end of the queue, or insert it as the next song to play. The queue is visible and reorderable — songs can be dragged to change position or removed entirely. When the queue is empty the auto-radio takes over and picks the next song automatically. The queue persists across the session but does not save between sessions.

### Add to Queue
**What it is:** Any song anywhere in the app — library, search results, a playlist, an artist page — can be added to the end of the current queue or inserted as the next song without interrupting what is currently playing.

### Queue Persistence Within Session
**What it is:** The queue stays intact for the duration of the session. If the user navigates away, switches profiles, or browses the library, the queue and the currently playing song are unaffected.

---



### Daily Playlist Profile Settings
**What it is:** Per-user setting that determines which taste profiles have daily playlists auto-generated every night. Secondary profiles are set to manual-only.

### Stay in Profile / Full Library Toggle
**What it is:** A runtime toggle that switches the auto-radio between drawing from the active profile only or the full library.

### Playlist Length Configuration
**What it is:** Target duration for each of the four daily playlists. Default 30 minutes. Configurable per user.
