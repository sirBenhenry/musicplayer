# Music App — UI Feature Brief

## What is this?

A self-hosted personal music streaming app. The user owns their music library stored on a local server and streams it to their phone and desktop. The core philosophy is full ownership and control over your music, with a discovery system that actively introduces new music every day through curated playlists. Think Spotify, but the library is yours, the data is yours, and the discovery is smarter and more personal.

---

## Features

### Library

**Song Library**
Your full personal music collection. Browse, search, and play everything you own. Songs can be filtered by artist, album, or taste profile.

**Artist Pages**
Individual pages per artist showing all their songs in your library, plus a follow button. Following an artist means new releases get automatically added to your library when they come out.

**New Release Notification**
When a followed artist releases something new and it gets added to your library, this is prominently surfaced so you don't miss it.

**Custom Playlists**
Create, name, and manage your own playlists manually. Add and remove songs freely.

**Search**
Search your full library by song title, artist, or album.

---

### Taste Profiles

**Taste Profiles**
Named collections that represent a distinct side of your music taste. A user can have multiple profiles (e.g. "Japanese artists", "chill beats", "heavy stuff"). Songs can be assigned to a profile. One profile is designated as the catch-all for songs that don't fit anywhere else.

**Profile Switcher**
Quickly switch the active profile context to filter what the next-song algorithm and auto-radio draw from.

**Song Profile Assignment**
When adding a song, you can assign it to a profile manually. If left unassigned, the app tries to auto-assign it. If the app is uncertain between two profiles, a small popup asks you to decide.

---

### Daily Discovery Playlists

Four playlists are generated every day to help you discover new music. Each is around 30 minutes long. These are the heart of the app.

**Playlist 1 — Close Match**
New songs and artists that sound almost identical to what you already love. Designed to find niche artists you've never heard of but would immediately click with.

**Playlist 2 — Broader Taste**
Songs that fit your general taste but push slightly further out. A little more experimental, still familiar enough to enjoy.

**Playlist 3 — New Genre**
A fully curated playlist in a genre you haven't explored yet, or haven't explored recently. Every playlist in this slot is a different genre so you're always encountering something new.

**Playlist 4 — Artist of the Day**
An introduction to a single new artist the app thinks you'd like. A short playlist made entirely of that artist's songs.

**Pause to Tomorrow**
A button on each daily playlist that lets you defer it to the next day if you don't have time. The playlist won't be replaced by a new one until you've had a chance to listen.

**Skip = Mark for Deletion**
Skipping a song in a daily playlist marks it for deletion. You don't have to do anything else.

**Listen Through = Keep**
If you listen to a song all the way through, it gets saved to your library automatically. No tapping required.

**End of Day Deletion Review**
Before songs marked for deletion are permanently removed, you can see the full list and rescue any you changed your mind about by tapping them.

**Profile Setting for Daily Lists**
In settings, choose which taste profiles get a daily playlist generated automatically. Secondary profiles don't auto-generate — you trigger them manually when you're in the mood.

**Manual Generate for Secondary Profiles**
A button to generate the daily discovery playlists for a specific taste profile on demand.

---

### Discovery History

**30-Day Playlist History**
A browsable log of every daily playlist from the past 30 days, stored as a tracklist (no audio, just titles and artists). Lets you go back and find a song you skipped but want another chance with.

**Re-download and Play Old Playlist**
From the history view, tap any past playlist to re-download its songs and play it again.

---

### Playback

**Auto-Radio / Next Song**
When a song ends, the app automatically picks the next song from your library that sounds acoustically similar — matching vibe, tempo, and mood. This is profile-aware, so it stays within the active profile by default.

**Stay in Profile / Full Library Toggle**
A toggle during playback to switch between drawing the next song from the active taste profile only, or from the full library.
