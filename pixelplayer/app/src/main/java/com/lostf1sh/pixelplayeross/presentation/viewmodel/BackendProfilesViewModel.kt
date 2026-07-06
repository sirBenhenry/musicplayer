package com.lostf1sh.pixelplayeross.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.lostf1sh.pixelplayeross.data.backend.BackendApiService
import com.lostf1sh.pixelplayeross.data.backend.BackendRepository
import com.lostf1sh.pixelplayeross.data.backend.model.BackendProfile
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

data class BackendProfilesUiState(
    val profiles: List<BackendProfile> = emptyList(),
    val isBusy: Boolean = false,
)

@HiltViewModel
class BackendProfilesViewModel @Inject constructor(
    private val api: BackendApiService,
    private val backendRepository: BackendRepository,
) : ViewModel() {

    private val busy = MutableStateFlow(false)

    val uiState: StateFlow<BackendProfilesUiState> = combine(
        backendRepository.profilesFlow, busy,
    ) { profiles, isBusy ->
        BackendProfilesUiState(profiles = profiles, isBusy = isBusy)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), BackendProfilesUiState())

    init {
        viewModelScope.launch { backendRepository.refreshProfiles() }
    }

    fun create(name: String) = action { api.createProfile(name) }

    fun rename(profile: BackendProfile, newName: String) = action { api.renameProfile(profile, newName) }

    fun delete(profile: BackendProfile) = action {
        api.deleteProfile(profile.id)
        // Deleted the active profile? Fall back to catchall.
        if (backendRepository.activeProfileIdFlow.value == profile.id) {
            backendRepository.setActiveProfile(
                backendRepository.profilesFlow.value.firstOrNull { it.isCatchall }?.id
            )
        }
    }

    private fun action(block: suspend () -> Unit) {
        if (busy.value) return
        viewModelScope.launch {
            busy.value = true
            runCatching { backendRepository.withAuthRetry { block() } }
                .onFailure { Timber.w(it, "profile action failed") }
            backendRepository.refreshProfiles()
            busy.value = false
        }
    }
}
