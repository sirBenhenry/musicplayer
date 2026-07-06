package com.lostf1sh.pixelplayeross.data.backend.model

/**
 * Models for the self-hosted discovery backend (FastAPI, /api/v1).
 *
 * The backend is the discovery/download brain that sits next to Navidrome:
 * taste profiles, auto-generated daily playlists, the multi-source download
 * pipeline, Lidarr artist following, and the skip/listen-through EOD loop.
 */

data class BackendProfile(
    val id: String,
    val name: String,
    val glyph: String?,
    val hue: Int?,
    val description: String?,
    val isCatchall: Boolean,
    val dailyAutoGenerate: Boolean,
)

/** One song entry inside a daily playlist (JSONB snapshot on the backend). */
data class DailySong(
    /** Backend song UUID — present once the download completed and was linked. */
    val id: String?,
    /** Navidrome id — lets us resolve the song against the local Room library. */
    val navidromeId: String?,
    val title: String,
    val artist: String,
    val durationSec: Int?,
    /** 'keep' | 'delete' | null — EOD flag from listen-through/skip events. */
    val flag: String?,
)

/** One of the 4 daily discovery slots (close / broader / genre / artist). */
data class DailyPlaylist(
    val id: String,
    val profileId: String,
    val slot: String,
    val date: String,
    val consumed: Boolean,
    val pausedToTomorrow: Boolean,
    val genreName: String?,
    val artistOfDay: String?,
    val songs: List<DailySong>,
)

data class BackendDownloadJob(
    val id: String,
    val artist: String,
    val title: String,
    val status: String,
    val sourceUsed: String?,
    val confidenceScore: Double?,
    val reviewStatus: String?,
    val lastError: String?,
    val createdAt: String?,
)

data class BackendNotification(
    val id: String,
    val type: String,
    val message: String,
    val createdAt: String?,
    val dismissed: Boolean,
    val actionTaken: String?,
    /** Structured payload for prompts: song_ids, genre_name, artist_name, action, playlist_profile_id. */
    val data: Map<String, Any?>?,
)

data class TrackSearchResult(
    val artist: String,
    val title: String,
    val album: String,
    val mbRecordingId: String?,
)

data class ArtistSearchResult(
    val mbid: String,
    val name: String,
    val genres: List<String>,
    val imageUrl: String?,
    val disambiguation: String?,
    val beginYear: Int?,
)

data class PendingDeletionItem(
    val songId: String,
    val title: String,
    val artist: String?,
    val scheduledFor: String?,
)

/** Login session for the backend. */
data class BackendSession(
    val serverUrl: String,
    val token: String,
)
