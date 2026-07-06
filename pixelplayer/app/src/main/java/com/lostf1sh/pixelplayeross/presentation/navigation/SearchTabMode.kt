package com.lostf1sh.pixelplayeross.presentation.navigation

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * Mode of the Search tab: local library search (upstream) or online
 * "Find New Music" search (backend). Toggled by re-tapping the Search nav
 * tab while it is already selected, or via the globe button in the search
 * bar. Singleton so the nav bar (outside the screen's composition) can
 * flip it — same pattern as [RadialSwitcherController].
 */
object SearchTabMode {
    var online by mutableStateOf(false)
        private set

    fun toggle() {
        online = !online
    }

    fun set(value: Boolean) {
        online = value
    }
}
