import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import utcnow

DAILY_SLOTS = ("close", "broader", "genre", "artist")


class DailyPlaylist(Base):
    __tablename__ = "daily_playlists"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("profiles.id"), nullable=False)
    slot: Mapped[str] = mapped_column(String(16), nullable=False)   # close|broader|genre|artist
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    songs: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    paused_to_tomorrow: Mapped[bool] = mapped_column(Boolean, default=False)
    generated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    profile: Mapped["Profile"] = relationship(back_populates="daily_playlists")  # type: ignore[name-defined]


class PlaylistHistory(Base):
    __tablename__ = "playlist_history"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slot: Mapped[str] = mapped_column(String(16), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    genre: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    tracklist: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GenreHistory(Base):
    __tablename__ = "genre_history"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    genre: Mapped[str] = mapped_column(String, nullable=False)
    used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    playlist_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("daily_playlists.id"), nullable=True)
