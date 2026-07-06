package com.lostf1sh.pixelplayeross.presentation.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.lostf1sh.pixelplayeross.data.backend.model.BackendNotification
import com.lostf1sh.pixelplayeross.data.backend.model.BackendProfile
import com.lostf1sh.pixelplayeross.presentation.components.MiniPlayerHeight
import com.lostf1sh.pixelplayeross.presentation.viewmodel.BackendNotificationsViewModel
import racra.compose.smooth_corner_rect_library.AbsoluteSmoothCornerShape

/**
 * Backend notification center: genre_prompt / artist_prompt cards with
 * accept-into-profile / decline actions, plus plain informational entries.
 */
@Composable
fun BackendNotificationsScreen(
    onBackClick: () -> Unit,
    viewModel: BackendNotificationsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val profiles by viewModel.profiles.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 8.dp),
        ) {
            IconButton(onClick = onBackClick) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back")
            }
            Text(
                text = "Notifications",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = { viewModel.refresh() }) {
                Icon(Icons.Rounded.Refresh, contentDescription = "Refresh")
            }
        }

        when {
            uiState.isLoading && uiState.notifications.isEmpty() -> Box(
                Modifier.fillMaxSize(), contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }

            uiState.notifications.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center,
            ) {
                Text(
                    uiState.error?.let { "Could not load: $it" } ?: "All caught up.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            else -> LazyColumn(
                contentPadding = PaddingValues(
                    start = 16.dp, end = 16.dp,
                    bottom = MiniPlayerHeight +
                        WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + 16.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(uiState.notifications, key = { it.id }) { notif ->
                    NotificationCard(
                        notif = notif,
                        profiles = profiles,
                        isBusy = notif.id in uiState.busyIds,
                        onAccept = { profileId, newName -> viewModel.accept(notif.id, profileId, newName) },
                        onDecline = { viewModel.decline(notif.id) },
                        onDismiss = { viewModel.dismiss(notif.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun NotificationCard(
    notif: BackendNotification,
    profiles: List<BackendProfile>,
    isBusy: Boolean,
    onAccept: (profileId: String?, newProfileName: String?) -> Unit,
    onDecline: () -> Unit,
    onDismiss: () -> Unit,
) {
    val isPrompt = notif.type == "genre_prompt" || notif.type == "artist_prompt"
    var pickingProfile by remember { mutableStateOf(false) }
    var selectedProfileId by remember { mutableStateOf<String?>(null) }

    Card(
        shape = AbsoluteSmoothCornerShape(20.dp, 60),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = when (notif.type) {
                        "genre_prompt" -> "New genre explored"
                        "artist_prompt" -> "Artist of the day"
                        "failed_to_fill" -> "Download problem"
                        else -> "Info"
                    },
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                if (!isPrompt) {
                    IconButton(onClick = onDismiss, enabled = !isBusy) {
                        Icon(Icons.Rounded.Close, contentDescription = "Dismiss", modifier = Modifier.size(18.dp))
                    }
                }
            }
            Text(
                text = notif.message,
                style = MaterialTheme.typography.bodyMedium,
            )

            if (isPrompt) {
                Spacer(Modifier.height(10.dp))
                if (isBusy) {
                    CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
                } else if (!pickingProfile) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                if (notif.type == "artist_prompt") {
                                    // artist prompts assign to the originating profile
                                    onAccept(null, null)
                                } else {
                                    pickingProfile = true
                                }
                            },
                            shape = AbsoluteSmoothCornerShape(14.dp, 60),
                            modifier = Modifier.weight(1f),
                        ) { Text("Keep") }
                        OutlinedButton(
                            onClick = onDecline,
                            shape = AbsoluteSmoothCornerShape(14.dp, 60),
                            modifier = Modifier.weight(1f),
                        ) { Text("Delete songs") }
                    }
                } else {
                    Text(
                        "Add songs to:",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(6.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        profiles.filter { !it.isCatchall }.forEach { profile ->
                            FilterChip(
                                selected = selectedProfileId == profile.id,
                                onClick = { selectedProfileId = profile.id },
                                label = { Text(profile.name) },
                            )
                        }
                        FilterChip(
                            selected = selectedProfileId == "new",
                            onClick = { selectedProfileId = "new" },
                            label = { Text("New profile (from genre name)") },
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { onAccept(selectedProfileId, null) },
                            enabled = selectedProfileId != null,
                            shape = AbsoluteSmoothCornerShape(14.dp, 60),
                            modifier = Modifier.weight(1f),
                        ) { Text("Confirm") }
                        OutlinedButton(
                            onClick = { pickingProfile = false },
                            shape = AbsoluteSmoothCornerShape(14.dp, 60),
                            modifier = Modifier.weight(1f),
                        ) { Text("Back") }
                    }
                }
            }
        }
    }
}
