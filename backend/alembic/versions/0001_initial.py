"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "profiles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("description", sa.String, nullable=True),
        sa.Column("glyph", sa.String(8), nullable=True),
        sa.Column("hue", sa.Integer, nullable=True),
        sa.Column("is_catchall", sa.Boolean, default=False),
        sa.Column("daily_auto_generate", sa.Boolean, default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    # Only one catchall allowed
    op.create_index(
        "uq_profiles_catchall",
        "profiles",
        ["is_catchall"],
        unique=True,
        postgresql_where=sa.text("is_catchall = true"),
    )

    op.create_table(
        "artists",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("navidrome_id", sa.String, nullable=False),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("followed", sa.Boolean, default=False),
        sa.Column("lidarr_id", sa.Integer, nullable=True),
        sa.Column("musicbrainz_id", sa.String, nullable=True),
        sa.Column("new_release_flagged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("uq_artists_navidrome_id", "artists", ["navidrome_id"], unique=True)

    op.create_table(
        "albums",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("navidrome_id", sa.String, nullable=False),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("artist_id", UUID(as_uuid=True), sa.ForeignKey("artists.id"), nullable=True),
        sa.Column("year", sa.Integer, nullable=True),
        sa.Column("cover_url", sa.String, nullable=True),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("uq_albums_navidrome_id", "albums", ["navidrome_id"], unique=True)

    op.create_table(
        "songs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("navidrome_id", sa.String, nullable=False),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("artist_id", UUID(as_uuid=True), sa.ForeignKey("artists.id"), nullable=True),
        sa.Column("album_id", UUID(as_uuid=True), sa.ForeignKey("albums.id"), nullable=True),
        sa.Column("duration_sec", sa.Integer, nullable=True),
        sa.Column("file_path", sa.Text, nullable=True),
        sa.Column("profile_id", UUID(as_uuid=True), sa.ForeignKey("profiles.id"), nullable=True),
        sa.Column("needs_profile_assignment", sa.Boolean, default=False),
        sa.Column("feature_vector", sa.Text, nullable=True),  # replaced by vector below
        sa.Column("analysed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("uq_songs_navidrome_id", "songs", ["navidrome_id"], unique=True)
    # Replace text placeholder with actual vector column
    op.execute("ALTER TABLE songs DROP COLUMN feature_vector")
    op.execute("ALTER TABLE songs ADD COLUMN feature_vector vector(128)")
    # HNSW index for cosine similarity (created after data load for performance)
    # op.execute("CREATE INDEX ON songs USING hnsw (feature_vector vector_cosine_ops) WITH (m=16, ef_construction=64)")

    op.create_table(
        "daily_playlists",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("profile_id", UUID(as_uuid=True), sa.ForeignKey("profiles.id"), nullable=False),
        sa.Column("slot", sa.String(16), nullable=False),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("songs", JSONB, nullable=True),
        sa.Column("paused_to_tomorrow", sa.Boolean, default=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_daily_playlists_date", "daily_playlists", ["date"])

    op.create_table(
        "song_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("song_id", UUID(as_uuid=True), sa.ForeignKey("songs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("playlist_id", UUID(as_uuid=True), sa.ForeignKey("daily_playlists.id", ondelete="SET NULL"), nullable=True),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("progress_pct", sa.Float, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_song_events_created_at", "song_events", ["created_at"])

    op.create_table(
        "pending_deletions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("song_id", UUID(as_uuid=True), sa.ForeignKey("songs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("playlist_id", UUID(as_uuid=True), sa.ForeignKey("daily_playlists.id", ondelete="SET NULL"), nullable=True),
        sa.Column("marked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rescued", sa.Boolean, default=False),
    )

    op.create_table(
        "rejected_songs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("artist", sa.String, nullable=False),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "genre_history",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("genre", sa.String, nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("playlist_id", UUID(as_uuid=True), sa.ForeignKey("daily_playlists.id", ondelete="SET NULL"), nullable=True),
    )

    op.create_table(
        "download_jobs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("artist", sa.String, nullable=False),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("qb_hash", sa.String(64), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, default="queued"),
        sa.Column("playlist_id", UUID(as_uuid=True), sa.ForeignKey("daily_playlists.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_download_jobs_qb_hash", "download_jobs", ["qb_hash"])

    op.create_table(
        "playlist_history",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("slot", sa.String(16), nullable=False),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("genre", sa.String, nullable=True),
        sa.Column("tracklist", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_playlist_history_date", "playlist_history", ["date"])


def downgrade() -> None:
    op.drop_table("playlist_history")
    op.drop_table("download_jobs")
    op.drop_table("genre_history")
    op.drop_table("rejected_songs")
    op.drop_table("pending_deletions")
    op.drop_table("song_events")
    op.drop_table("daily_playlists")
    op.drop_table("songs")
    op.drop_table("albums")
    op.drop_table("artists")
    op.drop_table("profiles")
    op.execute("DROP EXTENSION IF EXISTS vector")
