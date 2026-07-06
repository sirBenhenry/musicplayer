package com.lostf1sh.pixelplayeross.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lostf1sh.pixelplayeross.data.backend.DiscoveryRepository.ResolvedDailyPlaylist
import com.lostf1sh.pixelplayeross.data.backend.model.BackendProfile
import racra.compose.smooth_corner_rect_library.AbsoluteSmoothCornerShape

/**
 * Home-screen discovery surface: taste-profile chips + today's daily slots.
 *
 * Slots come from the self-hosted backend (close / broader / genre / artist)
 * and are played through the normal player pipeline once their songs are
 * synced into the local Navidrome library.
 */
@Composable
fun DiscoveryDailySection(
    profiles: List<BackendProfile>,
    activeProfileId: String?,
    slots: List<ResolvedDailyPlaylist>,
    onSelectProfile: (String) -> Unit,
    onOpenSlot: (ResolvedDailyPlaylist) -> Unit,
    onPlaySlot: (ResolvedDailyPlaylist) -> Unit,
    onManageProfiles: () -> Unit = {},
) {
    val activeProfile = profiles.firstOrNull { it.id == activeProfileId }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
    ) {
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "DAILY DISCOVERY",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = buildString {
                        activeProfile?.glyph?.takeIf { it.isNotBlank() }?.let { append(it).append(' ') }
                        append(activeProfile?.name ?: "No profile")
                    },
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            IconButton(onClick = onManageProfiles) {
                Icon(
                    Icons.Rounded.Tune,
                    contentDescription = "Manage profiles",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(Modifier.height(10.dp))

        ProfileChipsRow(
            profiles = profiles,
            activeProfileId = activeProfileId,
            onSelectProfile = onSelectProfile,
        )

        if (slots.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            slots.forEach { slot ->
                DailySlotCard(
                    slot = slot,
                    onOpen = { onOpenSlot(slot) },
                    onPlay = { onPlaySlot(slot) },
                )
                Spacer(Modifier.height(10.dp))
            }
        }
    }
}

@Composable
fun ProfileChipsRow(
    profiles: List<BackendProfile>,
    activeProfileId: String?,
    onSelectProfile: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(profiles, key = { it.id }) { profile ->
            val selected = profile.id == activeProfileId
            FilterChip(
                selected = selected,
                onClick = { onSelectProfile(profile.id) },
                label = {
                    Text(
                        text = buildString {
                            profile.glyph?.takeIf { it.isNotBlank() }?.let { append(it).append(' ') }
                            append(profile.name)
                        },
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                shape = AbsoluteSmoothCornerShape(12.dp, 60),
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                    selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                ),
            )
        }
    }
}

private data class SlotStyle(val title: String, val gradient: List<Color>)

@Composable
private fun slotStyle(slot: ResolvedDailyPlaylist): SlotStyle {
    val scheme = MaterialTheme.colorScheme
    return when (slot.playlist.slot) {
        "close" -> SlotStyle("Close to Your Taste", listOf(scheme.primary, scheme.tertiary))
        "broader" -> SlotStyle("Branch Out", listOf(scheme.tertiary, scheme.secondary))
        "genre" -> SlotStyle(
            slot.playlist.genreName?.let { "New Genre: $it" } ?: "New Genre",
            listOf(scheme.secondary, scheme.primary),
        )
        "artist" -> SlotStyle(
            slot.playlist.artistOfDay?.let { "Artist of the Day: $it" } ?: "Artist of the Day",
            listOf(scheme.primary, scheme.secondary),
        )
        else -> SlotStyle(slot.playlist.slot, listOf(scheme.primary, scheme.tertiary))
    }
}

@Composable
private fun DailySlotCard(
    slot: ResolvedDailyPlaylist,
    onOpen: () -> Unit,
    onPlay: () -> Unit,
) {
    val style = slotStyle(slot)
    val playable = slot.playableSongs
    val pending = slot.pendingCount
    val thumbnails = remember(slot) { playable.take(3) }

    Card(
        shape = AbsoluteSmoothCornerShape(24.dp, 60),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(76.dp)
                .background(Brush.horizontalGradient(style.gradient.map { it.copy(alpha = 0.85f) })),
            contentAlignment = Alignment.CenterStart,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = style.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = buildString {
                            append("${playable.size} songs")
                            if (pending > 0) append(" · $pending downloading")
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f),
                    )
                }

                Row(horizontalArrangement = Arrangement.spacedBy((-12).dp)) {
                    thumbnails.forEach { song ->
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(CircleShape)
                                .border(2.dp, MaterialTheme.colorScheme.surface, CircleShape),
                        ) {
                            SmartImage(
                                model = song.albumArtUriString,
                                contentDescription = null,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxSize(),
                            )
                        }
                    }
                }

                if (playable.isNotEmpty()) {
                    Spacer(Modifier.width(10.dp))
                    FilledIconButton(
                        onClick = onPlay,
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = MaterialTheme.colorScheme.surface,
                            contentColor = MaterialTheme.colorScheme.primary,
                        ),
                        modifier = Modifier.size(40.dp),
                    ) {
                        Icon(Icons.Rounded.PlayArrow, contentDescription = "Play")
                    }
                }
            }
        }
    }
}
