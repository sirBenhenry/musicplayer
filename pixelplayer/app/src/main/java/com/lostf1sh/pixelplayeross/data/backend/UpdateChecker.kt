package com.lostf1sh.pixelplayeross.data.backend

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Checks GitHub releases of the personal fork for a newer sideload APK.
 * Same flow the old mobile app used: compare latest release tag_name against
 * the installed versionName; the repo must stay public for unauthenticated
 * API access.
 */
@Singleton
class UpdateChecker @Inject constructor(
    private val okHttpClient: OkHttpClient,
) {
    companion object {
        private const val RELEASES_URL =
            "https://api.github.com/repos/sirBenhenry/musicplayer/releases/latest"
    }

    data class UpdateInfo(
        val latestTag: String,
        val isNewer: Boolean,
        val htmlUrl: String,
        val apkUrl: String?,
    )

    suspend fun check(currentVersionName: String): Result<UpdateInfo> = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder().url(RELEASES_URL).get().build()
            okHttpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) error("GitHub API ${response.code}")
                val json = JSONObject(response.body?.string() ?: "{}")
                val tag = json.optString("tag_name")
                val apkUrl = json.optJSONArray("assets")?.let { assets ->
                    (0 until assets.length())
                        .map { assets.getJSONObject(it) }
                        .firstOrNull { it.optString("name").endsWith(".apk") }
                        ?.optString("browser_download_url")
                }
                UpdateInfo(
                    latestTag = tag,
                    isNewer = isNewer(tag, currentVersionName),
                    htmlUrl = json.optString("html_url"),
                    apkUrl = apkUrl,
                )
            }
        }.onFailure { Timber.w(it, "update check failed") }
    }

    /** Compare dotted numeric versions; tags may carry a leading 'v'. */
    private fun isNewer(tag: String, current: String): Boolean {
        fun parts(v: String) = v.removePrefix("v").split(".", "-")
            .mapNotNull { it.toIntOrNull() }
        val t = parts(tag)
        val c = parts(current)
        for (i in 0 until maxOf(t.size, c.size)) {
            val a = t.getOrElse(i) { 0 }
            val b = c.getOrElse(i) { 0 }
            if (a != b) return a > b
        }
        return false
    }
}
