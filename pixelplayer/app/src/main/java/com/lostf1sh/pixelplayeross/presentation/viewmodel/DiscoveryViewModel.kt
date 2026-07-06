package com.lostf1sh.pixelplayeross.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.lostf1sh.pixelplayeross.data.backend.BackendRepository
import com.lostf1sh.pixelplayeross.data.backend.DailyPlaybackReporter
import com.lostf1sh.pixelplayeross.data.backend.DiscoveryRepository
import com.lostf1sh.pixelplayeross.data.backend.DiscoveryRepository.ResolvedDailyPlaylist
import com.lostf1sh.pixelplayeross.data.backend.model.BackendProfile
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Drives the discovery surface: taste-profile chips and today's daily
 * playlist slots, backed by the self-hosted backend.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class DiscoveryViewModel @Inject constructor(
    private val backendRepository: BackendRepository,
    private val discoveryRepository: DiscoveryRepository,
    private val dailyPlaybackReporter: DailyPlaybackReporter,
) : ViewModel() {

    val isBackendConnected: StateFlow<Boolean> = backendRepository.isLoggedInFlow
    val profiles: StateFlow<List<BackendProfile>> = backendRepository.profilesFlow
    val activeProfileId: StateFlow<String?> = backendRepository.activeProfileIdFlow
    val today: StateFlow<List<ResolvedDailyPlaylist>> = discoveryRepository.todayFlow
    val isRefreshing: StateFlow<Boolean> = discoveryRepository.isRefreshing

    init {
        // Refresh profiles once per app start, then follow profile switches.
        viewModelScope.launch {
            backendRepository.isLoggedInFlow.collectLatest { loggedIn ->
                if (!loggedIn) {
                    discoveryRepository.clear()
                    return@collectLatest
                }
                backendRepository.refreshProfiles()
                backendRepository.activeProfileIdFlow.collectLatest { profileId ->
                    refreshFor(profileId)
                }
            }
        }
    }

    private suspend fun refreshFor(profileId: String?) {
        // Catchall profile: daily slots are per-profile; catchall shows all
        val profile = profiles.value.firstOrNull { it.id == profileId }
        val queryId = if (profile?.isCatchall == true) null else profileId
        discoveryRepository.refreshToday(queryId)
    }

    fun refresh() {
        viewModelScope.launch { refreshFor(activeProfileId.value) }
    }

    fun selectProfile(profileId: String) {
        backendRepository.setActiveProfile(profileId)
    }

    /**
     * Arm skip/listen-through reporting for a daily slot that is about to play.
     * Call right before handing the queue to the player.
     */
    fun armReporting(playlist: ResolvedDailyPlaylist) {
        val mapping = playlist.songs
            .filter { it.song != null && !it.backendSongId.isNullOrBlank() }
            .associate { it.song!!.id to it.backendSongId!! }
        if (mapping.isNotEmpty()) {
            dailyPlaybackReporter.armContext(playlist.playlist.id, mapping)
        }
    }
}
