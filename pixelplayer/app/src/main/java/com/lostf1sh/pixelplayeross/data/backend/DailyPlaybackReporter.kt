package com.lostf1sh.pixelplayeross.data.backend

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Reports daily-playlist playback outcomes to the backend EOD loop.
 *
 * Contract with the backend (api/playback.py):
 *  - listen-through (>= 90%) -> song gets assigned to the profile at EOD
 *  - skip (deliberate track change < 90%) -> PendingDeletion + 6-month
 *    RejectedSong ban. This is the core skip-to-delete mechanic, so skips are
 *    ONLY sent for deliberate advances while a daily slot is playing — never
 *    for pause/stop/app-kill.
 *
 * Context is armed by the discovery UI when a daily slot starts playing and
 * cleared when any other queue takes over. Song ids are the app's local
 * Song.id values mapped to backend song UUIDs.
 */
@Singleton
class DailyPlaybackReporter @Inject constructor(
    private val api: BackendApiService,
    private val backendRepository: BackendRepository,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile
    private var playlistId: String? = null

    @Volatile
    private var songIdMap: Map<String, String> = emptyMap()

    /** True while a daily slot's skip-to-delete session is active. */
    val isArmed: Boolean
        get() = playlistId != null

    fun armContext(playlistId: String, localToBackendIds: Map<String, String>) {
        this.playlistId = playlistId
        this.songIdMap = localToBackendIds
        Timber.d("DailyReporter: armed for playlist %s (%d songs)", playlistId, localToBackendIds.size)
    }

    fun clearContext() {
        if (playlistId != null) Timber.d("DailyReporter: context cleared")
        playlistId = null
        songIdMap = emptyMap()
    }

    /**
     * Called by ListeningStatsTracker when a listening session ends.
     *
     * @param localSongId       the app-side Song.id whose session ended
     * @param progressPct       0.0-1.0 fraction of the track that was heard
     * @param endedByTrackChange true when the session ended because another
     *                           track started (auto-advance or manual skip)
     */
    fun onSessionEnded(localSongId: String, progressPct: Double, endedByTrackChange: Boolean) {
        val pl = playlistId ?: return
        val backendSongId = songIdMap[localSongId] ?: return

        when {
            progressPct >= 0.90 -> post("listen-through for $backendSongId") {
                api.reportListenThrough(backendSongId, pl)
            }
            endedByTrackChange -> post("skip for $backendSongId (${(progressPct * 100).toInt()}%)") {
                api.reportSkip(backendSongId, pl, progressPct)
            }
            // paused/stopped below 90%: no signal — user may resume later
        }
    }

    private fun post(what: String, block: suspend () -> Unit) {
        scope.launch {
            runCatching { backendRepository.withAuthRetry { block() } }
                .onSuccess { Timber.d("DailyReporter: sent $what") }
                .onFailure { Timber.w(it, "DailyReporter: failed to send $what") }
        }
    }
}
