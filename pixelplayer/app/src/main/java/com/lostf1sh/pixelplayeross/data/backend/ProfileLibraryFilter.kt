package com.lostf1sh.pixelplayeross.data.backend

import com.lostf1sh.pixelplayeross.data.database.ActiveProfileFilterEntity
import com.lostf1sh.pixelplayeross.data.database.ProfileFilterDao
import com.lostf1sh.pixelplayeross.data.database.ProfileSongEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import timber.log.Timber
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Keeps the library's per-profile filter in sync with the backend:
 *
 * - `profile_songs`: navidrome song -> profile assignments, fetched from
 *   GET /songs and keyed as songs.content_uri_string ("navidrome://<id>").
 * - `active_profile_filter`: the profile the library is filtered to. NULL
 *   when the catchall profile is active or no backend session exists —
 *   the library then shows everything.
 *
 * Library dao queries reference both tables in sub-selects, so Room's
 * invalidation tracker refreshes every library flow/paging source the
 * moment the active profile flips — no repository plumbing.
 */
@Singleton
class ProfileLibraryFilter @Inject constructor(
    private val api: BackendApiService,
    private val backendRepository: BackendRepository,
    private val profileFilterDao: ProfileFilterDao,
) {
    private val started = AtomicBoolean(false)

    fun start(scope: CoroutineScope) {
        if (!started.compareAndSet(false, true)) return

        scope.launch {
            combine(
                backendRepository.activeProfileIdFlow,
                backendRepository.profilesFlow,
            ) { activeId, profiles ->
                val profile = profiles.firstOrNull { it.id == activeId }
                // Catchall (or unknown/no session) = no filtering.
                profile?.takeIf { !it.isCatchall }?.id
            }
                .distinctUntilChanged()
                .collect { filterId ->
                    runCatching {
                        if (filterId != null) refreshAssignments()
                        profileFilterDao.setActiveFilter(ActiveProfileFilterEntity(profileId = filterId))
                        Timber.d("ProfileLibraryFilter: active filter -> %s", filterId ?: "none")
                    }.onFailure {
                        Timber.w(it, "ProfileLibraryFilter: failed to apply filter")
                    }
                }
        }
    }

    /** Re-fetch song->profile assignments from the backend. */
    suspend fun refreshAssignments() {
        if (!api.hasSession) return
        runCatching {
            val map = backendRepository.withAuthRetry { api.getSongProfileMap() }
            val rows = map.mapNotNull { (navId, profileId) ->
                profileId?.let { ProfileSongEntity(contentUri = "navidrome://$navId", profileId = it) }
            }
            profileFilterDao.replaceAssignments(rows)
            Timber.d("ProfileLibraryFilter: synced %d assignments", rows.size)
        }.onFailure {
            Timber.w(it, "ProfileLibraryFilter: assignment sync failed")
        }
    }
}
