import uuid
from datetime import datetime
from typing import Optional

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import utcnow


class Artist(Base):
    __tablename__ = "artists"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    navidrome_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    followed: Mapped[bool] = mapped_column(Boolean, default=False)
    lidarr_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    musicbrainz_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    new_release_flagged_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    albums: Mapped[list["Album"]] = relationship(back_populates="artist")
    songs: Mapped[list["Song"]] = relationship(back_populates="artist")


class Album(Base):
    __tablename__ = "albums"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    navidrome_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    artist_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("artists.id"), nullable=True)
    year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cover_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    artist: Mapped[Optional["Artist"]] = relationship(back_populates="albums")
    songs: Mapped[list["Song"]] = relationship(back_populates="album")


class Song(Base):
    __tablename__ = "songs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    navidrome_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    artist_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("artists.id"), nullable=True)
    album_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("albums.id"), nullable=True)
    duration_sec: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    file_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    title_romanized: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    display_artist: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    profile_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("profiles.id"), nullable=True)
    needs_profile_assignment: Mapped[bool] = mapped_column(Boolean, default=False)
    feature_vector: Mapped[Optional[list[float]]] = mapped_column(Vector(1280), nullable=True)
    analysed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    bpm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    key_root: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    key_mode: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)
    mood_happy: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    mood_sad: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    mood_aggressive: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    mood_relaxed: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    mood_party: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    beat_strength: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    spectral_centroid: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    dyn_complexity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    mb_recording_id: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    is_staged: Mapped[bool] = mapped_column(Boolean, default=False)
    has_cover: Mapped[bool] = mapped_column(Boolean, default=False)
    cover_fetch_attempts: Mapped[int] = mapped_column(Integer, default=0)
    cover_last_tried_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    artist: Mapped[Optional["Artist"]] = relationship(back_populates="songs")
    album: Mapped[Optional["Album"]] = relationship(back_populates="songs")
    profile: Mapped[Optional["Profile"]] = relationship(back_populates="songs")
