package com.lostf1sh.pixelplayeross.data.backend

import com.lostf1sh.pixelplayeross.data.backend.model.ArtistSearchResult
import com.lostf1sh.pixelplayeross.data.backend.model.BackendDownloadJob
import com.lostf1sh.pixelplayeross.data.backend.model.BackendNotification
import com.lostf1sh.pixelplayeross.data.backend.model.BackendProfile
import com.lostf1sh.pixelplayeross.data.backend.model.DailyPlaylist
import com.lostf1sh.pixelplayeross.data.backend.model.DailySong
import com.lostf1sh.pixelplayeross.data.backend.model.PendingDeletionItem
import com.lostf1sh.pixelplayeross.data.backend.model.TrackSearchResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Client for the self-hosted discovery backend (FastAPI, prefix /api/v1).
 *
 * Follows the NavidromeApiService pattern: plain OkHttp + org.json, runtime
 * credentials set by the repository, all calls suspend on IO.
 */
@Singleton
class BackendApiService @Inject constructor(
    baseOkHttpClient: OkHttpClient
) {

    companion object {
        private const val TAG = "BackendApi"
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }

    @Volatile
    private var serverUrl: String? = null

    @Volatile
    private var token: String? = null

    private val okHttpClient: OkHttpClient = baseOkHttpClient.newBuilder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    fun setSession(serverUrl: String?, token: String?) {
        this.serverUrl = serverUrl?.trim()?.trimEnd('/')
        this.token = token
    }

    val hasSession: Boolean
        get() = !serverUrl.isNullOrBlank() && !token.isNullOrBlank()

    // ─── Core request helpers ────────────────────────────────────────────

    private fun apiUrl(path: String): String {
        val base = serverUrl ?: throw IllegalStateException("Backend server URL not set")
        return "$base/api/v1$path"
    }

    private suspend fun execute(request: Request): String = withContext(Dispatchers.IO) {
        okHttpClient.newCall(request).execute().use { response ->
            val body = response.body?.string() ?: ""
            if (!response.isSuccessful) {
                Timber.w("$TAG: ${request.method} ${request.url.encodedPath} -> ${response.code}")
                throw BackendApiException(response.code, body.take(300))
            }
            body
        }
    }

    private fun authedRequest(path: String): Request.Builder {
        val builder = Request.Builder().url(apiUrl(path))
        token?.let { builder.header("Authorization", "Bearer $it") }
        return builder
    }

    private suspend fun getJson(path: String): String = execute(authedRequest(path).get().build())

    private suspend fun postJson(path: String, body: JSONObject? = null): String =
        execute(
            authedRequest(path)
                .post((body?.toString() ?: "{}").toRequestBody(JSON))
                .build()
        )

    // ─── Auth ────────────────────────────────────────────────────────────

    /** Login WITHOUT a stored session; url passed explicitly. Returns JWT. */
    suspend fun login(serverUrl: String, username: String, password: String): String {
        val url = serverUrl.trim().trimEnd('/')
        url.toHttpUrlOrNull() ?: throw IllegalArgumentException("Invalid backend URL")
        val payload = JSONObject().put("username", username).put("password", password)
        val request = Request.Builder()
            .url("$url/api/v1/auth/login")
            .post(payload.toString().toRequestBody(JSON))
            .build()
        val body = execute(request)
        val json = JSONObject(body)
        return json.optString("access_token").ifBlank { json.optString("token") }
            .also { if (it.isBlank()) throw BackendApiException(500, "No token in login response") }
    }

    /** Connection bundle: Navidrome URL + creds for the direct Subsonic account. */
    suspend fun getClientConfig(): Triple<String, String, String>? {
        val o = JSONObject(getJson("/auth/client-config"))
        val url = o.optString("navidrome_url")
        val user = o.optString("navidrome_username")
        val pass = o.optString("navidrome_password")
        return if (url.isNotBlank() && user.isNotBlank() && pass.isNotBlank())
            Triple(url, user, pass) else null
    }

    // ─── Profiles ────────────────────────────────────────────────────────

    suspend fun getProfiles(): List<BackendProfile> {
        val arr = JSONArray(getJson("/profiles"))
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            BackendProfile(
                id = o.getString("id"),
                name = o.getString("name"),
                glyph = o.optStringOrNull("glyph"),
                hue = if (o.has("hue") && !o.isNull("hue")) o.getInt("hue") else null,
                description = o.optStringOrNull("description"),
                isCatchall = o.optBoolean("is_catchall"),
                dailyAutoGenerate = o.optBoolean("daily_auto_generate"),
            )
        }
    }

    suspend fun createProfile(name: String): BackendProfile {
        val body = JSONObject().put("name", name).put("daily_auto_generate", true)
        val o = JSONObject(postJson("/profiles", body))
        return BackendProfile(
            id = o.getString("id"), name = o.getString("name"),
            glyph = o.optStringOrNull("glyph"),
            hue = if (o.isNull("hue")) null else o.optInt("hue"),
            description = o.optStringOrNull("description"),
            isCatchall = o.optBoolean("is_catchall"),
            dailyAutoGenerate = o.optBoolean("daily_auto_generate"),
        )
    }

    suspend fun renameProfile(profile: BackendProfile, newName: String) {
        // PUT expects the full ProfileIn shape — resend existing fields.
        val body = JSONObject()
            .put("name", newName)
            .put("description", profile.description ?: JSONObject.NULL)
            .put("glyph", profile.glyph ?: JSONObject.NULL)
            .put("hue", profile.hue ?: JSONObject.NULL)
            .put("is_catchall", profile.isCatchall)
            .put("daily_auto_generate", profile.dailyAutoGenerate)
        execute(
            authedRequest("/profiles/${profile.id}")
                .put(body.toString().toRequestBody(JSON))
                .build()
        )
    }

    suspend fun deleteProfile(profileId: String) {
        execute(authedRequest("/profiles/$profileId").delete().build())
    }

    // ─── Daily playlists ─────────────────────────────────────────────────

    suspend fun getToday(profileId: String?): List<DailyPlaylist> {
        val query = profileId?.let { "?profile_id=$it" } ?: ""
        val arr = JSONArray(getJson("/discovery/today$query"))
        return (0 until arr.length()).map { i -> parseDailyPlaylist(arr.getJSONObject(i)) }
    }

    suspend fun getDailyPlaylist(playlistId: String): DailyPlaylist =
        parseDailyPlaylist(JSONObject(getJson("/discovery/playlists/$playlistId")))

    suspend fun pauseDailyPlaylist(playlistId: String) =
        postJson("/discovery/playlists/$playlistId/pause")

    private fun parseDailyPlaylist(o: JSONObject): DailyPlaylist {
        val rawSongs = o.optJSONArray("songs") ?: JSONArray()
        var genreName: String? = null
        var artistOfDay: String? = null
        val songs = mutableListOf<DailySong>()
        for (i in 0 until rawSongs.length()) {
            val s = rawSongs.getJSONObject(i)
            when {
                s.has("_genre") -> genreName = s.optStringOrNull("_genre")
                s.has("_artist_of_day") -> artistOfDay = s.optStringOrNull("_artist_of_day")
                else -> songs.add(
                    DailySong(
                        id = s.optStringOrNull("id"),
                        navidromeId = s.optStringOrNull("navidrome_id"),
                        title = s.optString("title"),
                        artist = s.optString("artist"),
                        durationSec = if (s.isNull("duration_sec")) null else s.optInt("duration_sec"),
                        flag = s.optStringOrNull("flag"),
                    )
                )
            }
        }
        return DailyPlaylist(
            id = o.getString("id"),
            profileId = o.getString("profile_id"),
            slot = o.getString("slot"),
            date = o.optString("date"),
            consumed = o.optBoolean("consumed"),
            pausedToTomorrow = o.optBoolean("paused_to_tomorrow"),
            genreName = genreName,
            artistOfDay = artistOfDay,
            songs = songs,
        )
    }

    // ─── Playback events (daily playlist EOD loop) ──────────────────────

    suspend fun reportListenThrough(songId: String, playlistId: String?) {
        val body = JSONObject().put("song_id", songId)
        playlistId?.let { body.put("playlist_id", it) }
        postJson("/playback/listen-through", body)
    }

    suspend fun reportSkip(songId: String, playlistId: String?, progressPct: Double) {
        val body = JSONObject()
            .put("song_id", songId)
            .put("progress_pct", progressPct)
        playlistId?.let { body.put("playlist_id", it) }
        postJson("/playback/skip", body)
    }

    suspend fun reportProgress(songId: String, progressPct: Double, playlistId: String?) {
        val body = JSONObject()
            .put("song_id", songId)
            .put("progress_pct", progressPct)
        playlistId?.let { body.put("playlist_id", it) }
        postJson("/playback/progress", body)
    }

    // ─── Auto-radio ──────────────────────────────────────────────────────

    /** Chain of vibe-matched next songs. Returns navidrome ids (may be empty). */
    suspend fun getAutoRadioBatch(
        seedNavidromeId: String,
        count: Int,
        profileId: String?,
        bannedNavidromeIds: List<String>,
    ): List<String> {
        val params = buildString {
            append("/queue/auto-radio-batch?navidrome_id=")
            append(java.net.URLEncoder.encode(seedNavidromeId, "UTF-8"))
            append("&count=").append(count)
            profileId?.let { append("&profile_id=").append(it) }
            if (bannedNavidromeIds.isNotEmpty()) {
                append("&banned_navidrome_ids=")
                append(java.net.URLEncoder.encode(bannedNavidromeIds.joinToString(","), "UTF-8"))
            }
        }
        val obj = JSONObject(getJson(params))
        val arr = obj.optJSONArray("songs") ?: return emptyList()
        return (0 until arr.length()).mapNotNull { i ->
            arr.getJSONObject(i).optStringOrNull("navidrome_id")
        }
    }

    // ─── Downloads ───────────────────────────────────────────────────────

    suspend fun getDownloads(limit: Int = 100): List<BackendDownloadJob> {
        val arr = JSONArray(getJson("/downloads?limit=$limit"))
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            BackendDownloadJob(
                id = o.getString("id"),
                artist = o.optString("artist"),
                title = o.optString("title"),
                status = o.optString("status"),
                sourceUsed = o.optStringOrNull("source_used"),
                confidenceScore = if (o.isNull("confidence_score")) null else o.optDouble("confidence_score"),
                reviewStatus = o.optStringOrNull("review_status"),
                lastError = o.optStringOrNull("last_error"),
                createdAt = o.optStringOrNull("created_at"),
            )
        }
    }

    suspend fun requestTrackDownload(artist: String, title: String, mbRecordingId: String?, profileId: String?) {
        val body = JSONObject().put("artist", artist).put("title", title)
        mbRecordingId?.let { body.put("mb_recording_id", it) }
        profileId?.let { body.put("profile_id", it) }
        postJson("/downloads/track", body)
    }

    suspend fun retryDownload(jobId: String) = postJson("/downloads/$jobId/retry")

    suspend fun cancelDownload(jobId: String) = postJson("/downloads/$jobId/cancel")

    suspend fun reviewDownload(jobId: String, action: String) =
        postJson("/downloads/$jobId/review", JSONObject().put("action", action))

    /** Pipeline step log — list of {ts, step, status, message}. */
    suspend fun getDownloadPipeline(jobId: String): List<String> {
        val o = JSONObject(getJson("/downloads/$jobId/pipeline"))
        val arr = o.optJSONArray("pipeline_log") ?: JSONArray()
        return (0 until arr.length()).map { i ->
            val e = arr.getJSONObject(i)
            val ts = e.optString("ts").let { if (it.length >= 19) it.substring(11, 19) else it }
            "$ts  ${e.optString("step")}  ${e.optString("message")}"
        }
    }

    /** Spotify playlist/album import → creates UserPlaylist + queues downloads. */
    suspend fun importSpotifyPlaylist(url: String, profileId: String?): String {
        val body = JSONObject().put("url", url)
        profileId?.let { body.put("profile_id", it) }
        val o = JSONObject(postJson("/playlists/import-spotify", body))
        return "${o.optString("name")}: ${o.optInt("track_count")} tracks queued"
    }

    /** Raw system-status JSON (services/storage/library/downloads). */
    suspend fun getSystemStatus(): JSONObject = JSONObject(getJson("/admin/system-status"))

    // ─── Search new music ────────────────────────────────────────────────

    suspend fun searchTracks(query: String): List<TrackSearchResult> {
        val arr = JSONArray(getJson("/tracks/search?q=${query.urlEncode()}"))
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            TrackSearchResult(
                artist = o.optString("artist"),
                title = o.optString("title"),
                album = o.optString("album"),
                mbRecordingId = o.optStringOrNull("mb_recording_id"),
            )
        }
    }

    suspend fun searchArtists(query: String): List<ArtistSearchResult> {
        val arr = JSONArray(getJson("/artists/search?q=${query.urlEncode()}"))
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            val genres = o.optJSONArray("genres")?.let { g ->
                (0 until g.length()).map { g.getString(it) }
            } ?: emptyList()
            ArtistSearchResult(
                mbid = o.optString("mbid"),
                name = o.optString("name"),
                genres = genres,
                imageUrl = o.optStringOrNull("image_url"),
                disambiguation = o.optStringOrNull("disambiguation"),
                beginYear = if (o.isNull("begin_year")) null else o.optInt("begin_year"),
            )
        }
    }

    /** Add artist to Lidarr; optionally follow + queue full discography download. */
    suspend fun importArtist(mbid: String, name: String, follow: Boolean, downloadRecordings: Boolean) {
        val body = JSONObject()
            .put("mbid", mbid)
            .put("name", name)
            .put("follow", follow)
            .put("download_recordings", downloadRecordings)
        postJson("/artists/import", body)
    }

    // ─── Notifications ───────────────────────────────────────────────────

    suspend fun getNotifications(): List<BackendNotification> {
        val arr = JSONArray(getJson("/notifications"))
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            BackendNotification(
                id = o.getString("id"),
                type = o.optString("type"),
                message = o.optString("message"),
                createdAt = o.optStringOrNull("created_at"),
                dismissed = o.optBoolean("dismissed"),
                actionTaken = o.optStringOrNull("action_taken"),
                data = o.optJSONObject("data")?.toMap(),
            )
        }
    }

    suspend fun getNotificationCount(): Int =
        JSONObject(getJson("/notifications/count")).optInt("count", 0)

    suspend fun dismissNotification(id: String) = postJson("/notifications/$id/dismiss")

    suspend fun notificationAction(
        id: String,
        accept: Boolean,
        profileId: String? = null,
        newProfileName: String? = null,
    ) {
        val body = JSONObject().put("accept", accept)
        profileId?.let { body.put("profile_id", it) }
        newProfileName?.let { body.put("new_profile_name", it) }
        postJson("/notifications/$id/action", body)
    }

    suspend fun dismissAllNotifications() = postJson("/notifications/dismiss-all")

    // ─── Deletion rescue ─────────────────────────────────────────────────

    suspend fun getPendingDeletions(): List<PendingDeletionItem> {
        val arr = JSONArray(getJson("/deletion/pending"))
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            PendingDeletionItem(
                songId = o.optString("song_id", o.optString("id")),
                title = o.optString("title"),
                artist = o.optStringOrNull("artist"),
                scheduledFor = o.optStringOrNull("scheduled_for"),
            )
        }
    }

    suspend fun rescueSong(songId: String) = postJson("/deletion/$songId/rescue")

    // ─── Songs / profile assignment ──────────────────────────────────────

    /** Map of navidrome_id -> profile_id for profile-filtered library views. */
    suspend fun getSongProfileMap(): Map<String, String?> {
        val arr = JSONArray(getJson("/songs"))
        val map = HashMap<String, String?>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val navId = o.optStringOrNull("navidrome_id") ?: continue
            map[navId] = o.optStringOrNull("profile_id")
        }
        return map
    }
}

class BackendApiException(val code: Int, message: String) : Exception("HTTP $code: $message")

// ─── Small JSON helpers ─────────────────────────────────────────────────

private fun JSONObject.optStringOrNull(key: String): String? =
    if (has(key) && !isNull(key)) optString(key).ifBlank { null } else null

private fun JSONObject.toMap(): Map<String, Any?> =
    keys().asSequence().associateWith { k -> if (isNull(k)) null else get(k) }

private fun String.urlEncode(): String = java.net.URLEncoder.encode(this, "UTF-8")
