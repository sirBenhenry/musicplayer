package com.lostf1sh.pixelplayeross.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.lostf1sh.pixelplayeross.data.backend.BackendApiService
import com.lostf1sh.pixelplayeross.data.backend.BackendRepository
import com.lostf1sh.pixelplayeross.data.backend.model.BackendNotification
import com.lostf1sh.pixelplayeross.data.backend.model.BackendProfile
import com.lostf1sh.pixelplayeross.data.backend.model.PendingDeletionItem
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

data class BackendNotificationsUiState(
    val notifications: List<BackendNotification> = emptyList(),
    val pendingDeletions: List<PendingDeletionItem> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val busyIds: Set<String> = emptySet(),
)

@HiltViewModel
class BackendNotificationsViewModel @Inject constructor(
    private val api: BackendApiService,
    private val backendRepository: BackendRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(BackendNotificationsUiState())
    val uiState: StateFlow<BackendNotificationsUiState> = _uiState.asStateFlow()

    val profiles: StateFlow<List<BackendProfile>> = backendRepository.profilesFlow

    init {
        refresh()
        viewModelScope.launch { backendRepository.refreshProfiles() }
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            runCatching { backendRepository.withAuthRetry { api.getNotifications() } }
                .onSuccess { list ->
                    _uiState.update { it.copy(notifications = list, isLoading = false) }
                }
                .onFailure { e ->
                    Timber.w(e, "notifications refresh failed")
                    _uiState.update { it.copy(isLoading = false, error = e.message) }
                }
            runCatching { backendRepository.withAuthRetry { api.getPendingDeletions() } }
                .onSuccess { dels -> _uiState.update { it.copy(pendingDeletions = dels) } }
                .onFailure { Timber.w(it, "pending deletions fetch failed") }
        }
    }

    fun dismiss(id: String) = busyAction(id) { api.dismissNotification(id) }

    fun accept(id: String, profileId: String?, newProfileName: String?) = busyAction(id) {
        api.notificationAction(id, accept = true, profileId = profileId, newProfileName = newProfileName)
    }

    fun decline(id: String) = busyAction(id) {
        api.notificationAction(id, accept = false)
    }

    fun rescue(songId: String) = busyAction(songId) { api.rescueSong(songId) }

    fun dismissAll() = busyAction("__all__") { api.dismissAllNotifications() }

    private fun busyAction(id: String, block: suspend () -> Unit) {
        if (id in _uiState.value.busyIds) return
        viewModelScope.launch {
            _uiState.update { it.copy(busyIds = it.busyIds + id) }
            runCatching { backendRepository.withAuthRetry { block() } }
                .onFailure { Timber.w(it, "notification action failed for %s", id) }
            _uiState.update { it.copy(busyIds = it.busyIds - id) }
            refresh()
        }
    }
}
