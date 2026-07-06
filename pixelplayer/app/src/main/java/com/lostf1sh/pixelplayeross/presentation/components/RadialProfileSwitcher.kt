package com.lostf1sh.pixelplayeross.presentation.components

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.lostf1sh.pixelplayeross.data.backend.model.BackendProfile
import com.lostf1sh.pixelplayeross.presentation.viewmodel.DiscoveryViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Radial taste-profile switcher — hold the Home tab, profile nodes fan out,
 * drag onto one and release to select. Port of the old app's signature
 * interaction, driven by a plain singleton so the nav-bar gesture (deep in
 * the player sheet) and the fullscreen overlay (root of MainActivity) don't
 * need a shared ViewModel.
 */
object RadialSwitcherController {
    val isOpen = MutableStateFlow(false)
    val anchor = MutableStateFlow(Offset.Zero)
    val pointer = MutableStateFlow(Offset.Zero)

    /** Monotonic tick — bumped on finger release while open. */
    val releaseTick = MutableStateFlow(0L)

    fun open(anchorInRoot: Offset) {
        anchor.value = anchorInRoot
        pointer.value = anchorInRoot
        isOpen.value = true
    }

    fun move(positionInRoot: Offset) {
        if (isOpen.value) pointer.value = positionInRoot
    }

    fun release() {
        if (isOpen.value) releaseTick.value += 1
    }

    fun close() {
        isOpen.value = false
    }
}

/** Deterministic clean color per profile: backend hue, or hash fallback. */
fun profileColor(profile: BackendProfile, isDark: Boolean): Color {
    val hue = (profile.hue ?: (profile.name.hashCode().mod(360))).toFloat()
    return if (isDark) Color.hsv(hue, 0.42f, 0.80f) else Color.hsv(hue, 0.48f, 0.66f)
}

private data class Node(val profile: BackendProfile, val center: Offset)

@Composable
fun RadialProfileOverlay() {
    val discoveryViewModel: DiscoveryViewModel = hiltViewModel()
    val isOpen by RadialSwitcherController.isOpen.collectAsStateWithLifecycle()
    if (!isOpen) return

    val profiles by discoveryViewModel.profiles.collectAsStateWithLifecycle()
    val activeProfileId by discoveryViewModel.activeProfileId.collectAsStateWithLifecycle()
    val anchor by RadialSwitcherController.anchor.collectAsStateWithLifecycle()
    val pointer by RadialSwitcherController.pointer.collectAsStateWithLifecycle()
    val releaseTick by RadialSwitcherController.releaseTick.collectAsStateWithLifecycle()

    if (profiles.isEmpty()) {
        RadialSwitcherController.close()
        return
    }

    val density = LocalDensity.current
    val nodeSize = 62.dp
    val nodeSizePx = with(density) { nodeSize.toPx() }
    val isDark = androidx.compose.foundation.isSystemInDarkTheme()

    // Fan the nodes in up to two arcs above the anchor (nav bar is at the bottom).
    val nodes = remember(profiles, anchor) {
        val innerCount = minOf(profiles.size, 6)
        val outerCount = profiles.size - innerCount
        val result = mutableListOf<Node>()
        val innerR = with(density) { 128.dp.toPx() }
        val outerR = with(density) { 214.dp.toPx() }
        fun arc(count: Int, radius: Float, items: List<BackendProfile>) {
            if (items.isEmpty()) return
            // Spread across 150° centred straight up (90°..? in screen coords up = -y)
            val spread = Math.toRadians(150.0)
            val start = Math.toRadians(195.0) // left-leaning start
            items.forEachIndexed { i, p ->
                val t = if (count == 1) 0.5 else i / (count - 1.0)
                val angle = start + t * spread
                val x = anchor.x + (radius * cos(angle)).toFloat()
                val y = anchor.y + (radius * sin(angle)).toFloat()
                result.add(Node(p, Offset(x, y)))
            }
        }
        arc(innerCount, innerR, profiles.take(innerCount))
        if (outerCount > 0) arc(outerCount, outerR, profiles.drop(innerCount))
        result
    }

    // Highlight the node closest to the finger, but only within grab distance.
    val grabRadiusPx = nodeSizePx * 1.15f
    val highlighted = remember(pointer, nodes) {
        nodes.minByOrNull { hypot(it.center.x - pointer.x, it.center.y - pointer.y) }
            ?.takeIf { hypot(it.center.x - pointer.x, it.center.y - pointer.y) <= grabRadiusPx }
    }

    // Finger released: commit highlighted profile (if any) and close.
    LaunchedEffect(releaseTick) {
        if (releaseTick > 0L) {
            highlighted?.let { discoveryViewModel.selectProfile(it.profile.id) }
            RadialSwitcherController.close()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.55f)),
    ) {
        nodes.forEach { node ->
            val isHighlighted = node === highlighted
            val isActive = node.profile.id == activeProfileId
            val scale by animateFloatAsState(
                targetValue = if (isHighlighted) 1.22f else 1f,
                animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
                label = "nodeScale",
            )
            val color = profileColor(node.profile, isDark)

            Box(
                modifier = Modifier
                    .offset {
                        IntOffset(
                            (node.center.x - nodeSizePx / 2).roundToInt(),
                            (node.center.y - nodeSizePx / 2).roundToInt(),
                        )
                    }
                    .size(nodeSize)
                    .scale(scale)
                    .graphicsLayer { shadowElevation = if (isHighlighted) 18f else 6f }
                    .clip(CircleShape)
                    .background(if (isHighlighted) color else color.copy(alpha = 0.92f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = node.profile.name.take(2).uppercase(),
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.titleMedium,
                )
                if (isActive) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .activeRing(),
                    )
                }
            }

            // Label under the highlighted node
            if (isHighlighted) {
                Text(
                    text = node.profile.name,
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.labelLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.offset {
                        IntOffset(
                            (node.center.x - nodeSizePx).roundToInt(),
                            (node.center.y + nodeSizePx * 0.78f).roundToInt(),
                        )
                    },
                )
            }
        }
    }
}

/** 2.5dp white ring marking the currently active profile. */
private fun Modifier.activeRing(): Modifier = border(2.5.dp, Color.White, CircleShape)
