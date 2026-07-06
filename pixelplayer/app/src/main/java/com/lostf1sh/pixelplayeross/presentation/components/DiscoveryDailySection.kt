package com.lostf1sh.pixelplayeross.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledIconButton
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
import com.lostf1sh.pixelplayeross.data.model.Song
import racra.compose.smooth_corner_rect_library.AbsoluteSmoothCornerShape

/**
 * Home discovery surface, composed in PixelPlayer's own visual language:
 * the Close Match slot inherits the Daily-Mix card recipe (gradient header,
 * three shaped thumbnails, inline song rows), Artist of the Day is a compact
 * row card, Broader/New-Genre form a half-width pair. Profile switching is
 * the radial hold-Home gesture; the header shows the active profile identity.
 */
@Composable
fun DiscoveryDailySection(
    profiles: List<BackendProfile>,
    activeProfileId: String?,
    slots: List<ResolvedDailyPlaylist>,
    onOpenSlot: (ResolvedDailyPlaylist) -> Unit,
    onPlaySlot: (ResolvedDailyPlaylist) -> Unit,
    onPlaySong: (ResolvedDailyPlaylist, Song) -> Unit,
    onManageProfiles: () -> Unit = {},
) {
    val activeProfile = profiles.firstOrNull { it.id == activeProfileId }
    val isDark = isSystemInDarkTheme()

    val close = slots.firstOrNull { it.playlist.slot == "close" }
    val artist = slots.firstOrNull { it.playlist.slot == "artist" }
    val pair = listOfNotNull(
        slots.firstOrNull { it.playlist.slot == "broader" },
        slots.firstOrNull { it.playlist.slot == "genre" },
    )

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
    ) {
        // ── Header: active profile identity ─────────────────────────────
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            if (activeProfile != null) {
                Box(
                    modifier = Modifier
                        .size(14.dp)
                        .clip(CircleShape)
                        .background(profileColor(activeProfile, isDark)),
                )
                Spacer(Modifier.width(10.dp))
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = activeProfile?.name ?: "Discovery",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "Hold the Home tab to switch profiles",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
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

        // ── Close Match: full Daily-Mix-style card ───────────────────────
        close?.let { slot ->
            Spacer(Modifier.height(12.dp))
            CloseMatchCard(slot, onOpenSlot, onPlaySlot, onPlaySong)
        }

        // ── Artist of the Day: compact row card ──────────────────────────
        artist?.let { slot ->
            Spacer(Modifier.height(10.dp))
            ArtistOfDayRow(slot, onOpenSlot)
        }

        // ── Broader + New Genre: half-width pair ─────────────────────────
        if (pair.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                pair.forEach { slot ->
                    PairTile(slot, onOpenSlot, modifier = Modifier.weight(1f))
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun CloseMatchCard(
    slot: ResolvedDailyPlaylist,
    onOpen: (ResolvedDailyPlaylist) -> Unit,
    onPlay: (ResolvedDailyPlaylist) -> Unit,
    onPlaySong: (ResolvedDailyPlaylist, Song) -> Unit,
) {
    val playable = slot.playableSongs
    val headerThumbs = remember(slot) { playable.take(3) }
    val previewSongs = remember(slot) { playable.take(4) }

    Card(
        shape = AbsoluteSmoothCornerShape(30.dp, 60),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        elevation = CardDefaults.cardElevation(0.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            // Gradient header — same recipe as the native Daily Mix card
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(80.dp)
                    .clickable { onOpen(slot) }
                    .background(
                        Brush.horizontalGradient(
                            listOf(
                                MaterialTheme.colorScheme.primary,
                                MaterialTheme.colorScheme.tertiary,
                            )
                        )
                    ),
                contentAlignment = Alignment.CenterStart,
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 22.dp, end = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Today's Picks",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                        Text(
                            text = buildString {
                                append("Close to your taste")
                                if (slot.pendingCount > 0) append(" · ${slot.pendingCount} downloading")
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f),
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy((-16).dp)) {
                        headerThumbs.forEachIndexed { index, song ->
                            Box(
                                modifier = Modifier
                                    .size(48.dp)
                                    .clip(threeShapeSwitch(index))
                                    .border(2.dp, MaterialTheme.colorScheme.surface, threeShapeSwitch(index)),
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
                }
            }

            // Inline song preview rows
            previewSongs.forEach { song ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onPlaySong(slot, song) }
                        .padding(horizontal = 14.dp, vertical = 7.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(42.dp)
                            .clip(AbsoluteSmoothCornerShape(12.dp, 60)),
                    ) {
                        SmartImage(
                            model = song.albumArtUriString,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            song.title,
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            song.artist,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }

            // Footer: open + play
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            ) {
                Text(
                    text = "View all ${playable.size} songs",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .weight(1f)
                        .clip(AbsoluteSmoothCornerShape(12.dp, 60))
                        .clickable { onOpen(slot) }
                        .padding(vertical = 8.dp, horizontal = 6.dp),
                )
                if (playable.isNotEmpty()) {
                    FilledIconButton(
                        onClick = { onPlay(slot) },
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = MaterialTheme.colorScheme.primaryContainer,
                            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                        ),
                        modifier = Modifier.size(42.dp),
                    ) {
                        Icon(Icons.Rounded.PlayArrow, contentDescription = "Play")
                    }
                }
            }
        }
    }
}

@Composable
private fun ArtistOfDayRow(
    slot: ResolvedDailyPlaylist,
    onOpen: (ResolvedDailyPlaylist) -> Unit,
) {
    val cover = slot.playableSongs.firstOrNull()?.albumArtUriString
    Card(
        shape = AbsoluteSmoothCornerShape(24.dp, 60),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        elevation = CardDefaults.cardElevation(0.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpen(slot) },
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(52.dp)
                    .clip(CircleShape)
                    .border(2.dp, MaterialTheme.colorScheme.surface, CircleShape),
            ) {
                SmartImage(
                    model = cover,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "ARTIST OF THE DAY",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = slot.playlist.artistOfDay ?: "New artist",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Icon(
                Icons.Rounded.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun PairTile(
    slot: ResolvedDailyPlaylist,
    onOpen: (ResolvedDailyPlaylist) -> Unit,
    modifier: Modifier = Modifier,
) {
    val label = if (slot.playlist.slot == "broader") "BRANCH OUT" else "NEW GENRE"
    val title = when (slot.playlist.slot) {
        "broader" -> "Broader taste"
        else -> slot.playlist.genreName ?: "New genre"
    }
    val cover = slot.playableSongs.firstOrNull()?.albumArtUriString

    Column(modifier = modifier.clickable { onOpen(slot) }) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(AbsoluteSmoothCornerShape(24.dp, 60)),
        ) {
            SmartImage(
                model = cover,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            // Bottom scrim so the tile reads even with bright covers
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0.45f to Color.Transparent,
                            1f to Color.Black.copy(alpha = 0.55f),
                        )
                    ),
            )
        }
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(top = 8.dp),
        )
        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
