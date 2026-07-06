package com.lostf1sh.pixelplayeross.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.lostf1sh.pixelplayeross.data.backend.BackendApiService
import com.lostf1sh.pixelplayeross.data.backend.BackendRepository
import com.lostf1sh.pixelplayeross.data.backend.model.BackendDownloadJob
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

data class BackendDownloadsUiState(
    val jobs: List<BackendDownloadJob> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val busyJobIds: Set<String> = emptySet(),
    val expandedJobId: String? = null,
    val pipelineLogs: Map<String, List<String>> = emptyMap(),
)

@HiltViewModel
class BackendDownloadsViewModel @Inject constructor(
    private val api: BackendApiService,
    private val backendRepository: BackendRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(BackendDownloadsUiState())
    val uiState: StateFlow<BackendDownloadsUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            runCatching { backendRepository.withAuthRetry { api.getDownloads(limit = 200) } }
                .onSuccess { jobs ->
                    _uiState.update { it.copy(jobs = jobs, isLoading = false) }
                }
                .onFailure { e ->
                    Timber.w(e, "downloads refresh failed")
                    _uiState.update { it.copy(isLoading = false, error = e.message) }
                }
        }
    }

    fun retry(jobId: String) = jobAction(jobId) { api.retryDownload(jobId) }

    fun cancel(jobId: String) = jobAction(jobId) { api.cancelDownload(jobId) }

    /** confirm | wrong_song | bad_quality */
    fun review(jobId: String, action: String) = jobAction(jobId) { api.reviewDownload(jobId, action) }

    fun toggleExpand(jobId: String) {
        val current = _uiState.value
        if (current.expandedJobId == jobId) {
            _uiState.update { it.copy(expandedJobId = null) }
            return
        }
        _uiState.update { it.copy(expandedJobId = jobId) }
        if (jobId !in current.pipelineLogs) {
            viewModelScope.launch {
                runCatching { backendRepository.withAuthRetry { api.getDownloadPipeline(jobId) } }
                    .onSuccess { log ->
                        _uiState.update { it.copy(pipelineLogs = it.pipelineLogs + (jobId to log)) }
                    }
                    .onFailure { Timber.w(it, "pipeline log fetch failed") }
            }
        }
    }

    private fun jobAction(jobId: String, block: suspend () -> Unit) {
        if (jobId in _uiState.value.busyJobIds) return
        viewModelScope.launch {
            _uiState.update { it.copy(busyJobIds = it.busyJobIds + jobId) }
            runCatching { backendRepository.withAuthRetry { block() } }
                .onFailure { Timber.w(it, "download action failed for %s", jobId) }
            _uiState.update { it.copy(busyJobIds = it.busyJobIds - jobId) }
            refresh()
        }
    }
}
