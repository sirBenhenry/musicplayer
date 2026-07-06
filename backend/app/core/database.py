from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from pgvector.sqlalchemy import Vector  # noqa: F401 — registers type
from .config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.db_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    # A dead Postgres connection must fail fast, not hang a scheduler job for
    # days (observed: nightly generation blocked 7/1–7/3 until a postgres
    # restart). pre_ping only covers checkout; these cover mid-query death.
    pool_recycle=1800,
    connect_args={
        "timeout": 30,           # connect timeout (s)
        "command_timeout": 300,  # per-statement timeout (s)
    },
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
