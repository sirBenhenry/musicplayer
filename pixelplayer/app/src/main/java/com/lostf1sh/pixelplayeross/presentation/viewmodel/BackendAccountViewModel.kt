package com.lostf1sh.pixelplayeross.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.lostf1sh.pixelplayeross.data.backend.BackendApiService
import com.lostf1sh.pixelplayeross.data.backend.BackendRepository
import com.lostf1sh.pixelplayeross.data.backend.model.BackendProfile
import com.lostf1sh.pixelplayeross.data.model.StorageFilter
import com.lostf1sh.pixelplayeross.data.navidrome.NavidromeRepository
import timber.log.Timber
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SystemStatusRow(val label: String, val detail: String, val ok: Boolean?)

data class BackendLoginUiState(
    val serverUrl: String = "",
    val username: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val loginSucceeded: Boolean = false,
    val statusRows: List<SystemStatusRow> = emptyList(),
)

@HiltViewModel
class BackendAccountViewModel @Inject constructor(
    private val backendRepository: BackendRepository,
    private val backendApi: BackendApiService,
    private val navidromeRepository: NavidromeRepository,
    private val libraryStateHolder: LibraryStateHolder,
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        BackendLoginUiState(serverUrl = backendRepository.serverUrl ?: "http://")
    )
    val uiState: StateFlow<BackendLoginUiState> = _uiState.asStateFlow()

    val isLoggedInFlow: StateFlow<Boolean> = backendRepository.isLoggedInFlow
    val profilesFlow: StateFlow<List<BackendProfile>> = backendRepository.profilesFlow
    val activeProfileIdFlow: StateFlow<String?> = backendRepository.activeProfileIdFlow

    fun onServerUrlChange(value: String) = _uiState.update { it.copy(serverUrl = value, error = null) }
    fun onUsernameChange(value: String) = _uiState.update { it.copy(username = value, error = null) }
    fun onPasswordChange(value: String) = _uiState.update { it.copy(password = value, error = null) }

    fun login() {
        val state = _uiState.value
        if (state.isLoading) return
        if (state.serverUrl.isBlank() || state.username.isBlank() || state.password.isBlank()) {
            _uiState.update { it.copy(error = "All fields are required") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val result = backendRepository.login(state.serverUrl, state.username, state.password)
            result.fold(
                onSuccess = {
                    backendRepository.refreshProfiles()
                    autoConfigureNavidrome()
                    // Server-only setup: this install plays from the server, not
                    // from files on the phone — hide MediaStore music.
                    libraryStateHolder.setStorageFilter(StorageFilter.ONLINE)
                    _uiState.update { it.copy(isLoading = false, loginSucceeded = true) }
                },
                onFailure = { e ->
                    _uiState.update {
                        it.copy(isLoading = false, error = e.message ?: "Login failed")
                    }
                }
            )
        }
    }

    /** One-login setup: pull Navidrome creds from the backend and connect the
     *  native Subsonic account if it isn't configured yet. Best-effort. */
    private suspend fun autoConfigureNavidrome() {
        if (navidromeRepository.isLoggedIn) return
        runCatching {
            val cfg = backendRepository.withAuthRetry { backendApi.getClientConfig() } ?: return
            navidromeRepository.login(cfg.first, cfg.second, cfg.third)
                .onSuccess { Timber.i("Navidrome auto-configured from backend") }
                .onFailure { Timber.w(it, "Navidrome auto-config login failed") }
        }.onFailure { Timber.w(it, "client-config fetch failed") }
    }

    fun setActiveProfile(profileId: String?) = backendRepository.setActiveProfile(profileId)

    fun refreshSystemStatus() {
        if (!backendRepository.isLoggedIn) return
        viewModelScope.launch {
            runCatching { backendRepository.withAuthRetry { backendApi.getSystemStatus() } }
                .onSuccess { st ->
                    val rows = mutableListOf<SystemStatusRow>()
                    val services = st.optJSONArray("services")
                    if (services != null) {
                        for (i in 0 until services.length()) {
                            val svc = services.getJSONObject(i)
                            val ok = svc.optBoolean("ok")
                            val detail = when {
                                !ok -> svc.optString("error", "unreachable")
                                svc.optString("name") == "qbittorrent" ->
                                    "${svc.optInt("active_torrents")} active torrents"
                                svc.has("version") -> "v${svc.optString("version")}"
                                else -> "ok"
                            }
                            rows.add(SystemStatusRow(svc.optString("name"), detail, ok))
                        }
                    }
                    st.optJSONObject("library")?.let { lib ->
                        rows.add(SystemStatusRow(
                            "library",
                            "${lib.optInt("songs")} songs · ${lib.optInt("artists")} artists",
                            null,
                        ))
                    }
                    st.optJSONObject("downloads")?.let { dl ->
                        rows.add(SystemStatusRow(
                            "downloads",
                            "${dl.optInt("queued")} queued · ${dl.optInt("downloading")} active · ${dl.optInt("failed")} failed",
                            null,
                        ))
                    }
                    st.optJSONObject("storage")?.let { sto ->
                        val freeGb = sto.optLong("disk_free_bytes") / 1_073_741_824
                        val musicGb = sto.optLong("music_bytes") / 1_073_741_824
                        if (freeGb > 0) rows.add(SystemStatusRow(
                            "storage", "${musicGb} GB music · ${freeGb} GB free", null,
                        ))
                    }
                    _uiState.update { it.copy(statusRows = rows) }
                }
                .onFailure { Timber.w(it, "system status fetch failed") }
        }
    }

    fun logout() = backendRepository.logout()
}
