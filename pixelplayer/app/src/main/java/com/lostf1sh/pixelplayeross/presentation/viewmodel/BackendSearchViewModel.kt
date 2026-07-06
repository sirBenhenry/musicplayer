package com.lostf1sh.pixelplayeross.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.lostf1sh.pixelplayeross.data.backend.BackendApiService
import com.lostf1sh.pixelplayeross.data.backend.BackendRepository
import com.lostf1sh.pixelplayeross.data.backend.model.ArtistSearchResult
import com.lostf1sh.pixelplayeross.data.backend.model.TrackSearchResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

enum class OnlineSearchMode { TRACKS, ARTISTS }

data class BackendSearchUiState(
    val query: String = "",
    val mode: OnlineSearchMode = OnlineSearchMode.TRACKS,
    val tracks: List<TrackSearchResult> = emptyList(),
    val artists: List<ArtistSearchResult> = emptyList(),
    val isSearching: Boolean = false,
    val error: String? = null,
    /** keys: "artist — title" for tracks, mbid for artists */
    val requested: Set<String> = emptySet(),
    val spotifyImporting: Boolean = false,
    val spotifyResult: String? = null,
)

/** Online search against the backend: MusicBrainz tracks + Lidarr artists. */
@HiltViewModel
class BackendSearchViewModel @Inject constructor(
    private val api: BackendApiService,
    private val backendRepository: BackendRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(BackendSearchUiState())
    val uiState: StateFlow<BackendSearchUiState> = _uiState.asStateFlow()

    private var searchJob: Job? = null

    fun onQueryChange(query: String) {
        _uiState.update { it.copy(query = query) }
        scheduleSearch()
    }

    fun onModeChange(mode: OnlineSearchMode) {
        _uiState.update { it.copy(mode = mode) }
        scheduleSearch(debounceMs = 0)
    }

    private fun scheduleSearch(debounceMs: Long = 450) {
        searchJob?.cancel()
        val query = _uiState.value.query.trim()
        if (query.length < 2) {
            _uiState.update { it.copy(tracks = emptyList(), artists = emptyList(), isSearching = false) }
            return
        }
        searchJob = viewModelScope.launch {
            if (debounceMs > 0) delay(debounceMs)
            _uiState.update { it.copy(isSearching = true, error = null) }
            runCatching {
                when (_uiState.value.mode) {
                    OnlineSearchMode.TRACKS -> backendRepository.withAuthRetry {
                        _uiState.update { it.copy(tracks = api.searchTracks(query)) }
                    }
                    OnlineSearchMode.ARTISTS -> backendRepository.withAuthRetry {
                        _uiState.update { it.copy(artists = api.searchArtists(query)) }
                    }
                }
            }.onFailure { e ->
                Timber.w(e, "online search failed")
                _uiState.update { it.copy(error = e.message) }
            }
            _uiState.update { it.copy(isSearching = false) }
        }
    }

    fun downloadTrack(track: TrackSearchResult) {
        val key = "${track.artist} — ${track.title}"
        if (key in _uiState.value.requested) return
        viewModelScope.launch {
            runCatching {
                backendRepository.withAuthRetry {
                    api.requestTrackDownload(
                        artist = track.artist,
                        title = track.title,
                        mbRecordingId = track.mbRecordingId,
                        profileId = backendRepository.activeProfileIdFlow.value
                            ?.takeIf { backendRepository.activeProfile?.isCatchall != true },
                    )
                }
            }.onSuccess {
                _uiState.update { it.copy(requested = it.requested + key) }
            }.onFailure { Timber.w(it, "track download request failed") }
        }
    }

    fun importSpotify(url: String) {
        if (_uiState.value.spotifyImporting || url.isBlank()) return
        viewModelScope.launch {
            _uiState.update { it.copy(spotifyImporting = true, spotifyResult = null) }
            runCatching {
                backendRepository.withAuthRetry {
                    api.importSpotifyPlaylist(
                        url.trim(),
                        backendRepository.activeProfileIdFlow.value
                            ?.takeIf { backendRepository.activeProfile?.isCatchall != true },
                    )
                }
            }.fold(
                onSuccess = { msg -> _uiState.update { it.copy(spotifyImporting = false, spotifyResult = msg) } },
                onFailure = { e ->
                    Timber.w(e, "spotify import failed")
                    _uiState.update { it.copy(spotifyImporting = false, spotifyResult = "Import failed: ${e.message}") }
                },
            )
        }
    }

    fun importArtist(artist: ArtistSearchResult, follow: Boolean, downloadAll: Boolean) {
        if (artist.mbid in _uiState.value.requested) return
        viewModelScope.launch {
            runCatching {
                backendRepository.withAuthRetry {
                    api.importArtist(artist.mbid, artist.name, follow, downloadAll)
                }
            }.onSuccess {
                _uiState.update { it.copy(requested = it.requested + artist.mbid) }
            }.onFailure { Timber.w(it, "artist import failed") }
        }
    }
}
