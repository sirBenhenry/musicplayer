import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal
from app.core.scheduler import start_scheduler, stop_scheduler
from app.api import auth, library, profiles, playback, deletion, discovery, history, queue, webhooks, admin, downloads, notifications, playlists
from app.api.library import stream_router
from app.models.profile import Profile

settings = get_settings()
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-create default catchall profile if none exist
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Profile).limit(1))
            if not result.scalar_one_or_none():
                db.add(Profile(name="My Music", glyph="♫", hue=30, is_catchall=True, daily_auto_generate=True))
                await db.commit()
                log.info("Created default profile 'My Music'")
    except Exception as e:
        log.warning("Could not auto-create default profile: %s", e)

    # Reset any jobs stuck in 'downloading' from a previous run — their asyncio tasks are gone
    try:
        from datetime import datetime, timezone, timedelta
        from sqlalchemy import update
        from app.models.events import DownloadJob
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                update(DownloadJob)
                .where(DownloadJob.status.in_(["downloading", "queued"]))
                .values(
                    status="failed",
                    last_error="interrupted by container restart",
                    next_retry_at=datetime.now(timezone.utc) - timedelta(minutes=1),
                )
                .returning(DownloadJob.id)
            )
            reset_count = len(result.fetchall())
            await db.commit()
            if reset_count:
                log.info("Startup: reset %d interrupted download jobs to failed", reset_count)
    except Exception as e:
        log.warning("Could not reset interrupted downloads on startup: %s", e)

    start_scheduler(settings)
    yield
    stop_scheduler()


app = FastAPI(title="Music App API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(stream_router, prefix="/api/v1")
app.include_router(library.router, prefix="/api/v1")
app.include_router(profiles.router, prefix="/api/v1")
app.include_router(playback.router, prefix="/api/v1")
app.include_router(deletion.router, prefix="/api/v1")
app.include_router(discovery.router, prefix="/api/v1")
app.include_router(history.router, prefix="/api/v1")
app.include_router(queue.router, prefix="/api/v1")
app.include_router(webhooks.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(downloads.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")
app.include_router(playlists.router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok"}
