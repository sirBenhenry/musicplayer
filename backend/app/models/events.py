import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import utcnow

EVENT_TYPES = ("skip", "listen_through", "half_listen", "rescued")


class SongEvent(Base):
    __tablename__ = "song_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    song_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("songs.id", ondelete="SET NULL"), nullable=True)
    playlist_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("daily_playlists.id", ondelete="SET NULL"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    progress_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class PendingDeletion(Base):
    __tablename__ = "pending_deletions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    song_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("songs.id", ondelete="CASCADE"), nullable=False)
    playlist_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("daily_playlists.id", ondelete="SET NULL"), nullable=True)
    marked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    rescued: Mapped[bool] = mapped_column(Boolean, default=False)


class RejectedSong(Base):
    __tablename__ = "rejected_songs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    artist: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    rejected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class DownloadJob(Base):
    __tablename__ = "download_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    artist: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    item_type: Mapped[str] = mapped_column(String(16), default="track")  # track|album|artist
    qb_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued|downloading|completed|failed|exhausted
    sources_tried: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    source_used: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    next_retry_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    playlist_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("daily_playlists.id", ondelete="SET NULL"), nullable=True)
    user_playlist_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("user_playlists.id", ondelete="SET NULL"), nullable=True, index=True)
    profile_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # MusicBrainz identity anchors
    mb_recording_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    mb_artist_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    mb_release_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)

    # Parallel search results + scoring
    candidates: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    selected_candidate: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    confidence_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    quality_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Post-download state
    review_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # pending_review|confirmed|wrong_song|bad_quality
    file_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    pipeline_log: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    auto_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class UserNotification(Base):
    __tablename__ = "user_notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type: Mapped[str] = mapped_column(String(40), nullable=False)  # quality_check|exhausted|upgrade_ready
    download_job_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("download_jobs.id", ondelete="CASCADE"), nullable=True
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False)
    action_taken: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # confirmed|wrong_song|bad_quality
    data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)  # structured payload for genre_prompt/artist_prompt
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    dismissed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
