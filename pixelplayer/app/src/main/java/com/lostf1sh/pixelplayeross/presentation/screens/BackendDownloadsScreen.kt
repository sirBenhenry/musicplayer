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
import androidx.compose.material.icons.rounded.Cancel
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Downloading
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.HourglassEmpty
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.lostf1sh.pixelplayeross.data.backend.model.BackendDownloadJob
import com.lostf1sh.pixelplayeross.presentation.components.MiniPlayerHeight
import com.lostf1sh.pixelplayeross.presentation.viewmodel.BackendDownloadsViewModel
import racra.compose.smooth_corner_rect_library.AbsoluteSmoothCornerShape

/** Backend download-pipeline job list: status, retry, cancel. */
@Composable
fun BackendDownloadsScreen(
    onBackClick: () -> Unit,
    viewModel: BackendDownloadsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

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
                text = "Downloads",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = { viewModel.refresh() }) {
                Icon(Icons.Rounded.Refresh, contentDescription = "Refresh")
            }
        }

        when {
            uiState.isLoading && uiState.jobs.isEmpty() -> Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }

            uiState.error != null && uiState.jobs.isEmpty() -> Box(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "Could not load downloads: ${uiState.error}",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            uiState.jobs.isEmpty() -> Box(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "No download jobs.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            else -> LazyColumn(
                contentPadding = PaddingValues(
                    start = 16.dp, end = 16.dp,
                    bottom = MiniPlayerHeight +
                        WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + 16.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val order = listOf("downloading", "failed", "exhausted", "queued", "completed")
                val sorted = uiState.jobs.sortedBy { j ->
                    if (j.reviewStatus == "pending_review" || j.reviewStatus == "bad_quality") -1
                    else order.indexOf(j.status).let { if (it < 0) order.size else it }
                }
                items(sorted, key = { it.id }) { job ->
                    DownloadJobCard(
                        job = job,
                        isBusy = job.id in uiState.busyJobIds,
                        isExpanded = uiState.expandedJobId == job.id,
                        pipelineLog = uiState.pipelineLogs[job.id],
                        onRetry = { viewModel.retry(job.id) },
                        onCancel = { viewModel.cancel(job.id) },
                        onReview = { action -> viewModel.review(job.id, action) },
                        onToggleExpand = { viewModel.toggleExpand(job.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun DownloadJobCard(
    job: BackendDownloadJob,
    isBusy: Boolean,
    isExpanded: Boolean,
    pipelineLog: List<String>?,
    onRetry: () -> Unit,
    onCancel: () -> Unit,
    onReview: (String) -> Unit,
    onToggleExpand: () -> Unit,
) {
    val (icon, tint) = when (job.status) {
        "completed" -> Icons.Rounded.CheckCircle to Color(0xFF2E7D32)
        "downloading" -> Icons.Rounded.Downloading to MaterialTheme.colorScheme.primary
        "queued" -> Icons.Rounded.HourglassEmpty to MaterialTheme.colorScheme.onSurfaceVariant
        else -> Icons.Rounded.ErrorOutline to MaterialTheme.colorScheme.error
    }

    val needsReview = job.reviewStatus == "pending_review" || job.reviewStatus == "bad_quality"

    Card(
        shape = AbsoluteSmoothCornerShape(18.dp, 60),
        colors = CardDefaults.cardColors(
            containerColor = if (needsReview) MaterialTheme.colorScheme.surfaceContainerHigh
            else MaterialTheme.colorScheme.surfaceContainer
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onToggleExpand),
    ) {
      Column {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Icon(icon, contentDescription = job.status, tint = tint, modifier = Modifier.size(24.dp))
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "${job.artist} — ${job.title}",
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = buildString {
                        append(job.status)
                        job.sourceUsed?.let { append(" · $it") }
                        job.confidenceScore?.let { append(" · ${it.toInt()}/100") }
                        if (job.status == "failed" && job.lastError != null) {
                            append(" · ${job.lastError.take(60)}")
                        }
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (isBusy) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
            } else {
                when (job.status) {
                    "failed", "exhausted" -> IconButton(onClick = onRetry) {
                        Icon(Icons.Rounded.Refresh, contentDescription = "Retry")
                    }
                    "queued", "downloading" -> IconButton(onClick = onCancel) {
                        Icon(Icons.Rounded.Cancel, contentDescription = "Cancel")
                    }
                }
            }
        }

        if (needsReview && !isBusy) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 14.dp, end = 14.dp, bottom = 10.dp),
            ) {
                androidx.compose.material3.TextButton(onClick = { onReview("confirm") }) { Text("Looks right") }
                androidx.compose.material3.TextButton(onClick = { onReview("wrong_song") }) { Text("Wrong song") }
                androidx.compose.material3.TextButton(onClick = { onReview("bad_quality") }) { Text("Bad quality") }
            }
        }

        if (isExpanded) {
            Column(modifier = Modifier.padding(start = 14.dp, end = 14.dp, bottom = 12.dp)) {
                if (pipelineLog == null) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                } else if (pipelineLog.isEmpty()) {
                    Text("No pipeline log.", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    pipelineLog.forEach { line ->
                        Text(
                            line,
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
      }
    }
}
