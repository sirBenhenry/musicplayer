package com.lostf1sh.pixelplayeross.presentation.screens

import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.rounded.HourglassEmpty
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import com.lostf1sh.pixelplayeross.presentation.components.MiniPlayerHeight
import com.lostf1sh.pixelplayeross.presentation.components.SmartImage
import com.lostf1sh.pixelplayeross.presentation.viewmodel.DiscoveryViewModel
import com.lostf1sh.pixelplayeross.presentation.viewmodel.PlayerViewModel
import kotlinx.collections.immutable.toImmutableList
import racra.compose.smooth_corner_rect_library.AbsoluteSmoothCornerShape

/**
 * Detail view for one daily discovery slot (close / broader / genre / artist).
 *
 * Playing from here arms skip/listen-through reporting: skipping a track
 * schedules it for deletion at EOD, listening through keeps it and assigns it
 * to the active profile.
 */
@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun DailySlotScreen(
    playlistId: String,
    onBackClick: () -> Unit,
    playerViewModel: PlayerViewModel,
    discoveryViewModel: DiscoveryViewModel = hiltViewModel(),
) {
    val today by discoveryViewModel.today.collectAsStateWithLifecycle()
    val slot = remember(today, playlistId) { today.firstOrNull { it.playlist.id == playlistId } }

    if (slot == null) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .padding(20.dp)
        ) {
            IconButton(onClick = onBackClick) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back")
            }
            Spacer(Modifier.height(24.dp))
            Text(
                "Playlist no longer available — it may have been processed overnight.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }

    val playable = remember(slot) { slot.playableSongs.toImmutableList() }
    val queueName = remember(slot) {
        when (slot.playlist.slot) {
            "close" -> "Daily · Close to Your Taste"
            "broader" -> "Daily · Branch Out"
            "genre" -> "Daily · ${slot.playlist.genreName ?: "New Genre"}"
            "artist" -> "Daily · ${slot.playlist.artistOfDay ?: "Artist of the Day"}"
            else -> "Daily Playlist"
        }
    }

    fun playFrom(startIndex: Int, shuffled: Boolean) {
        if (playable.isEmpty()) return
        discoveryViewModel.armReporting(slot)
        if (shuffled) {
            playerViewModel.playSongsShuffled(playable, queueName = queueName)
        } else {
            playerViewModel.playSongs(
                songsToPlay = playable,
                startSong = playable[startIndex],
                queueName = queueName,
            )
        }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding(),
        contentPadding = PaddingValues(
            bottom = MiniPlayerHeight +
                WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + 16.dp
        ),
    ) {
        item {
            Column(modifier = Modifier.padding(horizontal = 20.dp)) {
                Spacer(Modifier.height(8.dp))
                IconButton(onClick = onBackClick) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back")
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    text = queueName.removePrefix("Daily · "),
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = buildString {
                        append("${playable.size} songs")
                        if (slot.pendingCount > 0) append(" · ${slot.pendingCount} still downloading")
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "Listen through a song to keep it — skipping schedules it for deletion tonight.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = { playFrom(0, shuffled = false) },
                        enabled = playable.isNotEmpty(),
                        shape = AbsoluteSmoothCornerShape(16.dp, 60),
                        modifier = Modifier.weight(1f).height(48.dp),
                    ) {
                        Icon(Icons.Rounded.PlayArrow, contentDescription = null)
                        Spacer(Modifier.width(6.dp))
                        Text("Play", fontWeight = FontWeight.SemiBold)
                    }
                    FilledTonalButton(
                        onClick = { playFrom(0, shuffled = true) },
                        enabled = playable.isNotEmpty(),
                        shape = AbsoluteSmoothCornerShape(16.dp, 60),
                        modifier = Modifier.weight(1f).height(48.dp),
                    ) {
                        Icon(Icons.Rounded.Shuffle, contentDescription = null)
                        Spacer(Modifier.width(6.dp))
                        Text("Shuffle", fontWeight = FontWeight.SemiBold)
                    }
                }
                Spacer(Modifier.height(16.dp))
            }
        }

        items(slot.songs, key = { it.backendSongId ?: (it.artist + it.title) }) { entry ->
            val song = entry.song
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .then(
                        if (song != null) Modifier.clickable {
                            val idx = playable.indexOfFirst { it.id == song.id }
                            if (idx >= 0) playFrom(idx, shuffled = false)
                        } else Modifier
                    )
                    .padding(horizontal = 20.dp, vertical = 8.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .clip(AbsoluteSmoothCornerShape(12.dp, 60)),
                ) {
                    if (song != null) {
                        SmartImage(
                            model = song.albumArtUriString,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize(),
                        )
                    } else {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Rounded.HourglassEmpty,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = entry.title,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = if (song != null) MaterialTheme.colorScheme.onSurface
                        else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                    )
                    Text(
                        text = if (song != null) entry.artist else "${entry.artist} · downloading…",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}
