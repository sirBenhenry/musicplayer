"""Discovery pipeline orchestrator — generates all 4 daily playlists for a profile."""
import logging
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import delete, insert, select, update

from ..core.database import AsyncSessionLocal
from ..models.discovery import DailyPlaylist, GenreHistory
from ..models.events import RejectedSong
from ..models.library import Artist, Song
from ..models.profile import Profile
from ..services.llm import get_llm_provider
from . import artist_of_day, broader_taste, close_match, new_genre
from .downloader import queue_downloads

log = logging.getLogger(__name__)


async def generate_for_profile(profile_id: str) -> None:
    llm = get_llm_provider()
    today = date.today()

    async with AsyncSessionLocal() as db:
        profile_row = await db.get(Profile, profile_id)
        if not profile_row:
            log.error("generate_for_profile: unknown profile %s", profile_id)
            return
        profile = {
            "id": str(profile_row.id),
            "name": profile_row.name,
            "description": profile_row.description or "",
        }

        result = await db.execute(
            select(Song).where(Song.profile_id == profile_id).limit(500)
        )
        profile_songs_rows = result.scalars().all()
        profile_songs = [
            {"artist_name": str(s.artist_id), "title": s.title}
            for s in profile_songs_rows
        ]

        result = await db.execute(select(Artist.name))
        library_artists = [r[0] for r in result.all()]

        result = await db.execute(
            select(RejectedSong).where(RejectedSong.expires_at > datetime.now(timezone.utc))
        )
        rejected = [
            {"artist": r.artist, "title": r.title}
            for r in result.scalars().all()
        ]

        result = await db.execute(
            select(GenreHistory.genre)
            .order_by(GenreHistory.used_at.desc())
            .limit(30)
        )
        genre_history = [r[0] for r in result.all()]

    # --- Generate all 4 playlists concurrently (fire sequentially for simplicity) ---
    p1 = await close_match.generate(profile, profile_songs, library_artists, rejected, llm)
    p2 = await broader_taste.generate(profile, profile_songs, library_artists, rejected, llm)
    p3_result = await new_genre.generate(genre_history, llm)
    p4_result = await artist_of_day.generate(profile, profile_songs, library_artists, rejected, llm)

    p3 = p3_result.get("tracks", [])
    p4 = p4_result.get("tracks", [])

    slots = [
        ("close", p1),
        ("broader", p2),
        ("genre", p3),
        ("artist", p4),
    ]

    async with AsyncSessionLocal() as db:
        # Remove existing playlists for today/profile (regeneration)
        await db.execute(
            delete(DailyPlaylist).where(
                DailyPlaylist.profile_id == profile_id,
                DailyPlaylist.date == today,
            )
        )

        playlist_ids: list[tuple[str, str]] = []
        for slot, tracks in slots:
            if not tracks:
                log.warning("No tracks for profile=%s slot=%s", profile_id, slot)
                continue
            pid = str(uuid.uuid4())
            songs_payload = tracks
            if slot == "genre" and p3_result.get("genre"):
                # store genre name in songs list for reference
                songs_payload = [{"_genre": p3_result["genre"]}] + tracks
            if slot == "artist" and p4_result.get("artist"):
                songs_payload = [{"_artist_of_day": p4_result["artist"]}] + tracks

            await db.execute(insert(DailyPlaylist).values(
                id=pid,
                profile_id=profile_id,
                slot=slot,
                date=today,
                songs=songs_payload,
                paused_to_tomorrow=False,
                generated_at=datetime.now(timezone.utc),
            ))
            playlist_ids.append((pid, slot))

        # Record genre history
        if p3_result.get("genre"):
            await db.execute(insert(GenreHistory).values(
                id=str(uuid.uuid4()),
                genre=p3_result["genre"],
                used_at=datetime.now(timezone.utc),
                playlist_id=next((pid for pid, s in playlist_ids if s == "genre"), None),
            ))

        await db.commit()

    # Queue downloads for all generated playlists
    for pid, slot in playlist_ids:
        tracks = dict(slots).get(slot, [])
        if tracks:
            await queue_downloads(tracks, playlist_id=pid)

    log.info(
        "Discovery complete for profile=%s: %s slots generated",
        profile_id,
        len(playlist_ids),
    )


async def run_discovery() -> None:
    """Entry point called by nightly job — runs pipeline for all auto-generate profiles."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Profile).where(Profile.daily_auto_generate == True)
        )
        profiles = result.scalars().all()

    for profile in profiles:
        async with AsyncSessionLocal() as db:
            existing = await db.execute(
                select(DailyPlaylist).where(
                    DailyPlaylist.profile_id == str(profile.id),
                    DailyPlaylist.date == date.today(),
                    DailyPlaylist.paused_to_tomorrow == True,
                )
            )
            if existing.scalars().first():
                log.info("Profile %s paused to tomorrow, skipping", profile.name)
                continue

        try:
            await generate_for_profile(str(profile.id))
        except Exception as e:
            log.error("Discovery failed for profile %s: %s", profile.name, e)
