package com.lostf1sh.pixelplayeross.data.backend

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.lostf1sh.pixelplayeross.data.backend.model.BackendProfile
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Session + state holder for the discovery backend.
 *
 * Mirrors NavidromeRepository's credential pattern: EncryptedSharedPreferences
 * for the URL/JWT, StateFlow for login state, runtime credentials pushed into
 * the ApiService singleton on init and login.
 *
 * Also owns the active taste-profile selection (persisted), which drives the
 * daily-playlists section, profile-filtered library views, and auto-radio.
 */
@Singleton
class BackendRepository @Inject constructor(
    private val api: BackendApiService,
    @ApplicationContext private val context: Context,
) {
    companion object {
        private const val TAG = "BackendRepo"
        private const val PREFS_NAME = "backend_prefs"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_TOKEN = "token"
        private const val KEY_USERNAME = "username"
        private const val KEY_PASSWORD = "password"
        private const val KEY_ACTIVE_PROFILE_ID = "active_profile_id"
    }

    private val prefs: SharedPreferences = createCredentialPrefs()

    private fun createEncryptedPrefs(): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    private fun createCredentialPrefs(): SharedPreferences = try {
        createEncryptedPrefs()
    } catch (e: Exception) {
        Timber.e(e, "$TAG: EncryptedSharedPreferences unreadable, deleting and recreating")
        context.deleteSharedPreferences(PREFS_NAME)
        try {
            createEncryptedPrefs()
        } catch (e2: Exception) {
            Timber.e(e2, "$TAG: Encrypted prefs unavailable, falling back to plain")
            context.getSharedPreferences("${PREFS_NAME}_plain", Context.MODE_PRIVATE)
        }
    }

    private val _isLoggedInFlow = MutableStateFlow(false)
    val isLoggedInFlow: StateFlow<Boolean> = _isLoggedInFlow.asStateFlow()

    private val _activeProfileIdFlow = MutableStateFlow<String?>(null)
    val activeProfileIdFlow: StateFlow<String?> = _activeProfileIdFlow.asStateFlow()

    private val _profilesFlow = MutableStateFlow<List<BackendProfile>>(emptyList())
    val profilesFlow: StateFlow<List<BackendProfile>> = _profilesFlow.asStateFlow()

    init {
        restoreSession()
    }

    private fun restoreSession() {
        val url = prefs.getString(KEY_SERVER_URL, null)
        val token = prefs.getString(KEY_TOKEN, null)
        if (!url.isNullOrBlank() && !token.isNullOrBlank()) {
            api.setSession(url, token)
            _isLoggedInFlow.value = true
            Timber.d("$TAG: Restored backend session for $url")
        }
        _activeProfileIdFlow.value = prefs.getString(KEY_ACTIVE_PROFILE_ID, null)
    }

    val serverUrl: String?
        get() = prefs.getString(KEY_SERVER_URL, null)

    val isLoggedIn: Boolean
        get() = _isLoggedInFlow.value

    suspend fun login(serverUrl: String, username: String, password: String): Result<Unit> {
        return try {
            val token = api.login(serverUrl, username, password)
            prefs.edit {
                putString(KEY_SERVER_URL, serverUrl.trim().trimEnd('/'))
                putString(KEY_TOKEN, token)
                putString(KEY_USERNAME, username)
                putString(KEY_PASSWORD, password)
            }
            api.setSession(serverUrl, token)
            _isLoggedInFlow.value = true
            Timber.i("$TAG: Backend login OK ($serverUrl)")
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.w(e, "$TAG: Backend login failed")
            Result.failure(e)
        }
    }

    /** JWTs expire — re-login transparently with stored credentials on 401. */
    suspend fun <T> withAuthRetry(block: suspend () -> T): T {
        return try {
            block()
        } catch (e: BackendApiException) {
            if (e.code != 401) throw e
            val url = prefs.getString(KEY_SERVER_URL, null)
            val user = prefs.getString(KEY_USERNAME, null)
            val pass = prefs.getString(KEY_PASSWORD, null)
            if (url.isNullOrBlank() || user.isNullOrBlank() || pass.isNullOrBlank()) throw e
            Timber.d("$TAG: 401 — refreshing backend token")
            val token = api.login(url, user, pass)
            prefs.edit { putString(KEY_TOKEN, token) }
            api.setSession(url, token)
            block()
        }
    }

    fun logout() {
        prefs.edit {
            remove(KEY_TOKEN)
            remove(KEY_PASSWORD)
        }
        api.setSession(null, null)
        _isLoggedInFlow.value = false
        _profilesFlow.value = emptyList()
    }

    // ─── Profiles ────────────────────────────────────────────────────────

    suspend fun refreshProfiles(): Result<List<BackendProfile>> {
        return try {
            val profiles = withAuthRetry { api.getProfiles() }
            _profilesFlow.value = profiles
            // Default the active profile to the catchall on first login
            if (_activeProfileIdFlow.value == null) {
                profiles.firstOrNull { it.isCatchall }?.let { setActiveProfile(it.id) }
            }
            Result.success(profiles)
        } catch (e: Exception) {
            Timber.w(e, "$TAG: refreshProfiles failed")
            Result.failure(e)
        }
    }

    fun setActiveProfile(profileId: String?) {
        _activeProfileIdFlow.value = profileId
        prefs.edit { putString(KEY_ACTIVE_PROFILE_ID, profileId) }
    }

    val activeProfile: BackendProfile?
        get() = _profilesFlow.value.firstOrNull { it.id == _activeProfileIdFlow.value }
}
