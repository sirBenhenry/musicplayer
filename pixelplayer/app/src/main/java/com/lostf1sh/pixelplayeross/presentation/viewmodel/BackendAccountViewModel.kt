package com.lostf1sh.pixelplayeross.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.lostf1sh.pixelplayeross.data.backend.BackendApiService
import com.lostf1sh.pixelplayeross.data.backend.BackendRepository
import com.lostf1sh.pixelplayeross.data.backend.model.BackendProfile
import com.lostf1sh.pixelplayeross.data.navidrome.NavidromeRepository
import timber.log.Timber
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class BackendLoginUiState(
    val serverUrl: String = "",
    val username: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val loginSucceeded: Boolean = false,
)

@HiltViewModel
class BackendAccountViewModel @Inject constructor(
    private val backendRepository: BackendRepository,
    private val backendApi: BackendApiService,
    private val navidromeRepository: NavidromeRepository,
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

    fun logout() = backendRepository.logout()
}
