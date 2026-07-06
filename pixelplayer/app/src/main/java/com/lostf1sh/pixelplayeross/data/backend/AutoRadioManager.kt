package com.lostf1sh.pixelplayeross.data.backend

import com.lostf1sh.pixelplayeross.data.database.NavidromeDao
import com.lostf1sh.pixelplayeross.data.database.toSong
import com.lostf1sh.pixelplayeross.data.model.Song
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Fetches vibe-matched continuation songs from the backend when the playback
 * queue is about to run out, and resolves them to playable local [Song]s via
 * the Navidrome Room cache (same pattern as [DiscoveryRepository]).
 *
 * The backend picks by acoustic embedding similarity anchored to the queue's
 * last song, with mood/BPM/key scoring and rank-decay sampling — see
 * backend api/queue.py.
 */
@Singleton
class AutoRadioManager @Inject constructor(
    private val api: BackendApiService,
    private val backendRepository: BackendRepository,
    private val navidromeDao: NavidromeDao,
    private val dailyPlaybackReporter: DailyPlaybackReporter,
) {

    val isAvailable: Boolean
        get() = api.hasSession

    /** Don't auto-extend a daily slot — it's a skip-to-delete review session. */
    val isSuppressed: Boolean
        get() = dailyPlaybackReporter.isArmed

    /**
     * Next [count] songs continuing the vibe of [seed]. [recentQueueNavIds]
     * are excluded server-side so the extension never repeats the queue.
     * Returns playable songs only (unresolvable picks dropped).
     */
    suspend fun nextBatch(
        seed: Song,
        recentQueueNavIds: List<String>,
        count: Int = 5,
    ): List<Song> {
        val seedNavId = seed.navidromeId ?: return emptyList()
        if (!isAvailable) return emptyList()
        return runCatching {
            val navIds = backendRepository.withAuthRetry {
                api.getAutoRadioBatch(
                    seedNavidromeId = seedNavId,
                    count = count,
                    profileId = backendRepository.activeProfileIdFlow.value
                        ?.takeIf { backendRepository.activeProfile?.isCatchall != true },
                    bannedNavidromeIds = recentQueueNavIds.takeLast(50),
                )
            }
            navIds.mapNotNull { navidromeDao.getSongByNavidromeId(it)?.toSong() }
        }.onFailure {
            Timber.w(it, "AutoRadio: batch fetch failed")
        }.getOrDefault(emptyList())
    }
}
