package com.lostf1sh.pixelplayeross.data.database

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Transaction

/**
 * Backend taste-profile assignment per Navidrome song, synced from
 * GET /songs (navidrome_id -> profile_id). Key is the app-side
 * songs.content_uri_string value ("navidrome://<navidromeId>") so library
 * queries can filter with a plain sub-select — no join-table id mapping.
 */
@Entity(
    tableName = "profile_songs",
    indices = [Index(value = ["profile_id"])],
)
data class ProfileSongEntity(
    @PrimaryKey @ColumnInfo(name = "content_uri") val contentUri: String,
    @ColumnInfo(name = "profile_id") val profileId: String,
)

/**
 * Single-row table holding the active library filter. Library dao queries
 * reference it in a sub-select; because Room invalidation tracks every table
 * named in a query, flipping this row auto-refreshes all library flows and
 * paging sources — no parameter plumbing through the repositories.
 * profile_id NULL (or row absent) = no filtering (catchall / logged out).
 */
@Entity(tableName = "active_profile_filter")
data class ActiveProfileFilterEntity(
    @PrimaryKey val id: Int = 1,
    @ColumnInfo(name = "profile_id") val profileId: String?,
)

@Dao
interface ProfileFilterDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun setActiveFilter(filter: ActiveProfileFilterEntity)

    @Query("SELECT profile_id FROM active_profile_filter WHERE id = 1")
    suspend fun getActiveFilterProfileId(): String?

    @Query("DELETE FROM profile_songs")
    suspend fun clearAssignments()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAssignments(rows: List<ProfileSongEntity>)

    @Transaction
    suspend fun replaceAssignments(rows: List<ProfileSongEntity>) {
        clearAssignments()
        if (rows.isNotEmpty()) insertAssignments(rows)
    }

    @Query("SELECT COUNT(*) FROM profile_songs")
    suspend fun assignmentCount(): Int
}
