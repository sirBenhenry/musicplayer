import uuid
from datetime import datetime, timezone
from sqlalchemy import DateTime
from sqlalchemy.orm import mapped_column, MappedColumn
from sqlalchemy.dialects.postgresql import UUID


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def uuid_pk() -> MappedColumn:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def ts_now() -> MappedColumn:
    return mapped_column(DateTime(timezone=True), default=utcnow)
