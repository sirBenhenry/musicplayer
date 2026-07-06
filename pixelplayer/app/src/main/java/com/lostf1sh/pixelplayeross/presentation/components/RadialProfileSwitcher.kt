package com.lostf1sh.pixelplayeross.presentation.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.lostf1sh.pixelplayeross.data.backend.model.BackendProfile
import com.lostf1sh.pixelplayeross.presentation.viewmodel.DiscoveryViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Radial taste-profile switcher — hold the Home tab, nodes spring out with
 * bouncy per-node physics; drag onto one and release to select.
 *
 * Faithful port of the old app's interaction: bottom-up grid rows (max 3 per
 * row, centred on screen so nothing lands off-screen), seeded jitter for an
 * organic look, per-node underdamped springs with 35ms stagger, a hub ring
 * at the press point, and a ~52dp hover threshold.
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
        // Reset the tick BEFORE opening — a stale tick from the previous use
        // would make the overlay's release effect fire instantly and close it.
        releaseTick.value = 0L
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

private data class Node(val profile: BackendProfile, val target: Offset)

private val NodeRadius = 37.dp
private val HoverThreshold = 54.dp

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
    val configuration = LocalConfiguration.current
    val screenWidthPx = with(density) { configuration.screenWidthDp.dp.toPx() }
    val nodeRadiusPx = with(density) { NodeRadius.toPx() }
    val hoverThresholdPx = with(density) { HoverThreshold.toPx() }
    val isDark = isSystemInDarkTheme()

    // Layout: bottom-up grid rows, centred on SCREEN (the anchor may sit at
    // the screen edge — the Home tab is the leftmost nav item). Gap sizing
    // keeps 74dp nodes from overlapping; seeded jitter keeps it organic.
    val nodes = remember(profiles, anchor, screenWidthPx) {
        val colGapPx = with(density) { 106.dp.toPx() }
        val rowGapPx = with(density) { 102.dp.toPx() }
        val baseYPx = anchor.y - with(density) { 116.dp.toPx() }
        val minX = nodeRadiusPx + with(density) { 6.dp.toPx() }
        val maxX = screenWidthPx - nodeRadiusPx - with(density) { 6.dp.toPx() }
        val centerX = screenWidthPx / 2f
        val jitterX = with(density) { 11.dp.toPx() }
        val jitterY = with(density) { 8.dp.toPx() }

        val result = mutableListOf<Node>()
        var idx = 0
        var row = 0
        while (idx < profiles.size) {
            val remaining = profiles.size - idx
            val colsInRow = min(3, remaining)
            val rowY = baseYPx - row * rowGapPx
            val rowStartX = centerX - ((colsInRow - 1) * colGapPx) / 2f
            for (col in 0 until colsInRow) {
                val x = (rowStartX + col * colGapPx + (sin(idx * 2.6 + 1.1) * jitterX).toFloat())
                    .coerceIn(minX, maxX)
                val y = rowY + (cos(idx * 1.8 + 0.5) * jitterY).toFloat()
                result.add(Node(profiles[idx], Offset(x, y)))
                idx++
            }
            row++
        }
        result
    }

    // Hover: nearest node within threshold of the finger.
    val highlighted = remember(pointer, nodes) {
        nodes.minByOrNull { hypot(it.target.x - pointer.x, it.target.y - pointer.y) }
            ?.takeIf { hypot(it.target.x - pointer.x, it.target.y - pointer.y) <= hoverThresholdPx }
    }

    LaunchedEffect(releaseTick) {
        if (releaseTick > 0L) {
            highlighted?.let { discoveryViewModel.selectProfile(it.profile.id) }
            RadialSwitcherController.close()
        }
    }

    val backdropAlpha by animateFloatAsState(
        targetValue = 0.5f,
        animationSpec = tween(220),
        label = "backdrop",
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = backdropAlpha)),
    ) {
        HubRing(anchor)

        nodes.forEachIndexed { index, node ->
            ProfileNodeView(
                node = node,
                index = index,
                anchor = anchor,
                isHovered = node === highlighted,
                isActive = node.profile.id == activeProfileId,
                isDark = isDark,
                nodeRadiusPx = nodeRadiusPx,
            )
        }
    }
}

@Composable
private fun HubRing(anchor: Offset) {
    val density = LocalDensity.current
    val ringRadius = 34.dp
    val scale = remember { Animatable(0.5f) }
    val alpha = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        launch { alpha.animateTo(1f, tween(200)) }
        scale.animateTo(1f, spring(dampingRatio = 0.42f, stiffness = 140f))
    }
    val ringRadiusPx = with(density) { ringRadius.toPx() }
    Box(
        modifier = Modifier
            .offset {
                IntOffset(
                    (anchor.x - ringRadiusPx).roundToInt(),
                    (anchor.y - ringRadiusPx).roundToInt(),
                )
            }
            .size(ringRadius * 2)
            .graphicsLayer {
                scaleX = scale.value
                scaleY = scale.value
                this.alpha = alpha.value
            }
            .border(1.5.dp, MaterialTheme.colorScheme.primary, CircleShape),
    )
}

@Composable
private fun ProfileNodeView(
    node: Node,
    index: Int,
    anchor: Offset,
    isHovered: Boolean,
    isActive: Boolean,
    isDark: Boolean,
    nodeRadiusPx: Float,
) {
    // One uniform spring for every node + a tight sequential stagger: the
    // formation ripples outward as a clean wave (single gentle overshoot),
    // not a shower of independently bouncing balls.
    val progress = remember(node.profile.id) { Animatable(0f) }
    LaunchedEffect(node.profile.id) {
        delay(index * 22L)
        progress.animateTo(1f, spring(dampingRatio = 0.68f, stiffness = 520f))
    }

    val hoverScale by animateFloatAsState(
        targetValue = if (isHovered) 1.22f else 1f,
        animationSpec = spring(dampingRatio = 0.55f, stiffness = 260f),
        label = "hover",
    )

    val surface = MaterialTheme.colorScheme.surface
    val primary = MaterialTheme.colorScheme.primary
    val dotColor = profileColor(node.profile, isDark)

    Box(
        modifier = Modifier
            .offset {
                // Read the spring inside the lambda: position updates run in the
                // layout phase only — no per-frame recomposition (jank source).
                val p = progress.value
                val cx = anchor.x + (node.target.x - anchor.x) * p
                val cy = anchor.y + (node.target.y - anchor.y) * p
                IntOffset(
                    (cx - nodeRadiusPx).roundToInt(),
                    (cy - nodeRadiusPx).roundToInt(),
                )
            }
            .size(NodeRadius * 2)
            .graphicsLayer {
                val p = progress.value.coerceIn(0f, 1f)
                alpha = p
                scaleX = hoverScale
                scaleY = hoverScale
                shadowElevation = if (isHovered) 24f else 8f
                shape = CircleShape
            }
            .clip(CircleShape)
            .background(if (isHovered) primary else surface)
            .then(
                when {
                    isHovered -> Modifier
                    isActive -> Modifier.border(2.dp, primary, CircleShape)
                    else -> Modifier.border(
                        1.dp,
                        MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f),
                        CircleShape,
                    )
                }
            ),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 6.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(16.dp)
                    .clip(CircleShape)
                    .background(if (isHovered) MaterialTheme.colorScheme.onPrimary else dotColor),
            )
            Text(
                text = node.profile.name,
                color = if (isHovered) MaterialTheme.colorScheme.onPrimary
                else MaterialTheme.colorScheme.onSurface,
                fontSize = 10.sp,
                lineHeight = 12.sp,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 3.dp),
            )
        }
        if (isActive && !isHovered) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 7.dp)
                    .size(5.dp)
                    .clip(CircleShape)
                    .background(primary),
            )
        }
    }
}
