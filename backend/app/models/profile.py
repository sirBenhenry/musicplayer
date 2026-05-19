import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import utcnow


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    glyph: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    hue: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_catchall: Mapped[bool] = mapped_column(Boolean, default=False)
    daily_auto_generate: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    songs: Mapped[list["Song"]] = relationship(back_populates="profile")  # type: ignore[name-defined]
    daily_playlists: Mapped[list["DailyPlaylist"]] = relationship(back_populates="profile")  # type: ignore[name-defined]
