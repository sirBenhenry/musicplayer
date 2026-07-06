package com.lostf1sh.pixelplayeross.data.backend

import com.lostf1sh.pixelplayeross.data.backend.model.DailyPlaylist
import com.lostf1sh.pixelplayeross.data.database.NavidromeDao
import com.lostf1sh.pixelplayeross.data.database.toSong
import com.lostf1sh.pixelplayeross.data.model.Song
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Daily discovery playlists from the backend, resolved against the local
 * Navidrome-synced Room library so slots can be played with the native player.
 *
 * A daily-playlist song only becomes playable once (a) the backend finished
 * downloading it, (b) Navidrome indexed it, and (c) the app's Navidrome sync
 * pulled it into Room. Songs that haven't completed that chain yet are
 * reported via [ResolvedDailyPlaylist.pendingCount] so the UI can show
 * "3 songs still downloading" instead of silently shrinking the list.
 */
@Singleton
class DiscoveryRepository @Inject constructor(
    private val api: BackendApiService,
    private val backendRepository: BackendRepository,
    private val navidromeDao: NavidromeDao,
) {
    data class ResolvedDailySong(
        val song: Song?,           // null = not in local library yet
        val backendSongId: String?, // backend UUID, needed for playback event reporting
        val title: String,
        val artist: String,
    )

    data class ResolvedDailyPlaylist(
        val playlist: DailyPlaylist,
        val songs: List<ResolvedDailySong>,
    ) {
        val playableSongs: List<Song> get() = songs.mapNotNull { it.song }
        val pendingCount: Int get() = songs.count { it.song == null }
    }

    private val _todayFlow = MutableStateFlow<List<ResolvedDailyPlaylist>>(emptyList())
    val todayFlow: StateFlow<List<ResolvedDailyPlaylist>> = _todayFlow.asStateFlow()

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

    /** Fetch today's slots for the given profile and resolve against Room. */
    suspend fun refreshToday(profileId: String?): Result<List<ResolvedDailyPlaylist>> {
        if (!api.hasSession) return Result.success(emptyList())
        _isRefreshing.value = true
        return try {
            val playlists = backendRepository.withAuthRetry { api.getToday(profileId) }
            val resolved = playlists
                .sortedBy { slotOrder(it.slot) }
                .map { pl ->
                    ResolvedDailyPlaylist(
                        playlist = pl,
                        songs = pl.songs.map { s ->
                            val local = s.navidromeId
                                ?.takeIf { it.isNotBlank() }
                                ?.let { navidromeDao.getSongByNavidromeId(it)?.toSong() }
                            ResolvedDailySong(
                                song = local,
                                backendSongId = s.id,
                                title = s.title,
                                artist = s.artist,
                            )
                        },
                    )
                }
            _todayFlow.value = resolved
            Result.success(resolved)
        } catch (e: Exception) {
            Timber.w(e, "DiscoveryRepo: refreshToday failed")
            Result.failure(e)
        } finally {
            _isRefreshing.value = false
        }
    }

    fun playlistById(playlistId: String): ResolvedDailyPlaylist? =
        _todayFlow.value.firstOrNull { it.playlist.id == playlistId }

    fun clear() {
        _todayFlow.value = emptyList()
    }

    private fun slotOrder(slot: String): Int = when (slot) {
        "close" -> 0
        "broader" -> 1
        "genre" -> 2
        "artist" -> 3
        else -> 4
    }
}
