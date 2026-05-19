import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

from app.core.config import get_settings
from app.core.scheduler import start_scheduler, stop_scheduler
from app.api import auth, library, profiles, playback, deletion, discovery, history, queue, webhooks, admin, downloads

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
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


@app.get("/health")
async def health():
    return {"status": "ok"}
