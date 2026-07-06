package com.lostf1sh.pixelplayeross.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.lostf1sh.pixelplayeross.data.backend.UpdateChecker
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class UpdateUiState(
    val checking: Boolean = false,
    val latestTag: String? = null,
    /** Set only when a newer release exists — APK asset url or release page. */
    val updateUrl: String? = null,
    val message: String? = null,
)

@HiltViewModel
class UpdateViewModel @Inject constructor(
    private val updateChecker: UpdateChecker,
) : ViewModel() {

    private val _state = MutableStateFlow(UpdateUiState())
    val state: StateFlow<UpdateUiState> = _state.asStateFlow()

    fun check(currentVersionName: String) {
        if (_state.value.checking) return
        viewModelScope.launch {
            _state.update { UpdateUiState(checking = true) }
            updateChecker.check(currentVersionName).fold(
                onSuccess = { info ->
                    _state.update {
                        if (info.isNewer) {
                            UpdateUiState(
                                latestTag = info.latestTag,
                                updateUrl = info.apkUrl ?: info.htmlUrl,
                            )
                        } else {
                            UpdateUiState(message = "Up to date (${info.latestTag.ifBlank { "no releases" }})")
                        }
                    }
                },
                onFailure = { e ->
                    _state.update { UpdateUiState(message = "Check failed: ${e.message}") }
                },
            )
        }
    }
}
