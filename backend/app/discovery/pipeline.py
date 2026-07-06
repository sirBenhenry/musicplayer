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


async def _expire_stale_playlists(db, profile_id: str, today: date) -> None:
    """Delete unconsumed playlists older than 7 days + their staged songs."""
    import os
    from datetime import timedelta
    from ..core.config import get_settings

    cutoff = today - timedelta(days=7)
    result = await db.execute(
        select(DailyPlaylist).where(
            DailyPlaylist.profile_id == profile_id,
            DailyPlaylist.consumed == False,  # noqa: E712
            DailyPlaylist.date < cutoff,
        )
    )
    stale = result.scalars().all()
    if not stale:
        return

    music_dir = get_settings().MUSIC_DIR
    for pl in stale:
        song_ids = [s["id"] for s in (pl.songs or []) if s.get("id")]
        for sid in song_ids:
            try:
                song = await db.get(Song, uuid.UUID(sid))
            except ValueError:
                continue
            if song and song.is_staged:
                if song.file_path:
                    abs_path = song.file_path if song.file_path.startswith("/") \
                        else os.path.join(music_dir, song.file_path)
                    try:
                        if os.path.exists(abs_path):
                            os.remove(abs_path)
                    except OSError as e:
                        log.warning("expire: failed to delete file %s: %s", abs_path, e)
                await db.delete(song)
        await db.delete(pl)
        log.info("expired stale playlist %s (slot=%s date=%s, %d staged songs cleaned)",
                 str(pl.id)[:8], pl.slot, pl.date, len(song_ids))
    await db.commit()


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

        # Expire stale unconsumed playlists (>7 days old): delete them and any
        # still-staged songs they own, so the slot frees up with fresh content
        # instead of accumulating zombies forever.
        await _expire_stale_playlists(db, profile_id, today)

        # Find which slots already have an unconsumed playlist — ANY date, not
        # just today. A playlist the user hasn't touched blocks regeneration;
        # generating 4 fresh playlists every night regardless of usage flooded
        # the library with ~200 downloads/day.
        existing_result = await db.execute(
            select(DailyPlaylist.slot).where(
                DailyPlaylist.profile_id == profile_id,
                DailyPlaylist.consumed == False,
            )
        )
        skip_slots = {row[0] for row in existing_result.all()}

        needed_slots = [s for s in ("close", "broader", "genre", "artist") if s not in skip_slots]
        if not needed_slots:
            log.info("generate_for_profile: all slots active for profile=%s, skipping", profile_id)
            return

        from sqlalchemy.orm import selectinload as _sil
        result = await db.execute(
            select(Song).where(Song.profile_id == profile_id)
            .options(_sil(Song.artist))
            .limit(500)
        )
        profile_songs_rows = result.scalars().all()
        profile_songs = [
            {"artist_name": s.artist.name if s.artist else "", "title": s.title}
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

        # Genre playlist is shared across all profiles — reuse today's if any exists
        shared_genre_songs = None
        if "genre" in needed_slots:
            gr = await db.execute(
                select(DailyPlaylist).where(
                    DailyPlaylist.slot == "genre",
                    DailyPlaylist.date == today,
                ).limit(1)
            )
            existing_genre = gr.scalar_one_or_none()
            if existing_genre:
                shared_genre_songs = existing_genre.songs or []

    # Close + broader share one last.fm/ListenBrainz candidate fetch (DSC-4) —
    # the pool is identical, so fetch once when either slot is needed.
    shared_candidates = None
    if "close" in needed_slots or "broader" in needed_slots:
        seed_artists = close_match._sample_artists(profile_songs, library_artists, n=10)
        shared_candidates = await close_match._fetch_candidates(seed_artists, library_artists, rejected)

    p1 = await close_match.generate(profile, profile_songs, library_artists, rejected, llm, candidates=shared_candidates) if "close" in needed_slots else []
    p2 = await broader_taste.generate(profile, profile_songs, library_artists, rejected, llm, candidates=shared_candidates) if "broader" in needed_slots else []
    if shared_genre_songs is not None:
        genre_name = next((s["_genre"] for s in shared_genre_songs if s.get("_genre")), None)
        p3_result = {"genre": genre_name, "tracks": [s for s in shared_genre_songs if not s.get("_genre")]}
    elif "genre" in needed_slots:
        p3_result = await new_genre.generate(genre_history, llm)
    else:
        p3_result = {}
    p4_result = await artist_of_day.generate(profile, profile_songs, library_artists, rejected, llm) if "artist" in needed_slots else {}

    p3 = p3_result.get("tracks", [])
    p4 = p4_result.get("tracks", [])

    slots = [
        ("close", p1),
        ("broader", p2),
        ("genre", p3),
        ("artist", p4),
    ]

    async with AsyncSessionLocal() as db:
        # Delete only consumed playlists (keep unconsumed/paused ones)
        await db.execute(
            delete(DailyPlaylist).where(
                DailyPlaylist.profile_id == profile_id,
                DailyPlaylist.date == today,
                DailyPlaylist.consumed == True,
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
                consumed=False,
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


async def refill_playlist(pl) -> None:
    """Fill holes in a close/broader playlist with fresh LLM suggestions.

    Called by EOD after processing interacted songs. Generates up to
    (_PLAYLIST_TARGET_SIZE - current_song_count) new suggestions, appends
    them to the playlist JSONB, and queues downloads.

    Reliability: LLM failure → retry once → last.fm fallback → skip.
    Songs are added to JSONB before queuing so they're tracked even if queue fails.
    """
    from sqlalchemy.orm import selectinload
    from sqlalchemy.orm.attributes import flag_modified as _fm
    from ..models.library import Artist, Song
    from ..models.events import RejectedSong
    from ..services import lastfm

    _TARGET = 9

    async with AsyncSessionLocal() as db:
        pl_obj = await db.get(type(pl), pl.id)
        if not pl_obj:
            return

        current_songs = [s for s in (pl_obj.songs or [])
                         if not s.get("_genre") and not s.get("_artist_of_day")]
        hole_count = max(0, _TARGET - len(current_songs))
        if hole_count == 0:
            return

        profile_row = await db.get(Profile, pl.profile_id)
        if not profile_row:
            return
        profile = {"id": str(profile_row.id), "name": profile_row.name, "description": profile_row.description or ""}

        result = await db.execute(
            select(Song).where(Song.profile_id == pl.profile_id)
            .options(selectinload(Song.artist))
            .limit(500)
        )
        profile_songs = [
            {"artist_name": s.artist.name if s.artist else "", "title": s.title}
            for s in result.scalars().all()
        ]

        result = await db.execute(select(Artist.name))
        library_artists = [r[0] for r in result.all()]

        result = await db.execute(
            select(RejectedSong).where(RejectedSong.expires_at > datetime.now(timezone.utc))
        )
        rejected = [{"artist": r.artist, "title": r.title} for r in result.scalars().all()]

        # Avoid re-suggesting songs already in the playlist
        existing_titles = {s.get("title", "").lower() for s in current_songs}
        rejected_extended = rejected + [{"artist": "", "title": t} for t in existing_titles]

    llm = get_llm_provider()
    new_tracks: list[dict] = []

    # LLM attempt 1 (normal)
    try:
        if pl.slot == "close":
            candidates = await close_match.generate(profile, profile_songs, library_artists, rejected_extended, llm)
        else:
            candidates = await broader_taste.generate(profile, profile_songs, library_artists, rejected_extended, llm)
        new_tracks = [t for t in candidates if t.get("title", "").lower() not in existing_titles][:hole_count]
    except Exception as e:
        log.warning("refill_playlist: LLM attempt 1 failed for %s: %s", str(pl.id)[:8], e)

    # LLM attempt 2 (retry)
    if not new_tracks:
        try:
            if pl.slot == "close":
                candidates = await close_match.generate(profile, profile_songs, library_artists, rejected_extended, llm)
            else:
                candidates = await broader_taste.generate(profile, profile_songs, library_artists, rejected_extended, llm)
            new_tracks = [t for t in candidates if t.get("title", "").lower() not in existing_titles][:hole_count]
        except Exception as e:
            log.warning("refill_playlist: LLM attempt 2 failed for %s: %s", str(pl.id)[:8], e)

    # Last.fm fallback
    if not new_tracks and profile_songs:
        try:
            seed_artist = profile_songs[0]["artist_name"]
            similar = await lastfm.get_similar_artists(seed_artist, limit=10)
            for s in similar[:5]:
                name = s.get("name", "")
                if not name:
                    continue
                top = await lastfm.get_top_tracks(name, limit=3)
                for t in top:
                    title = t.get("name", "")
                    if title and title.lower() not in existing_titles:
                        new_tracks.append({"artist": name, "title": title})
                        if len(new_tracks) >= hole_count:
                            break
                if len(new_tracks) >= hole_count:
                    break
        except Exception as e:
            log.warning("refill_playlist: last.fm fallback failed for %s: %s", str(pl.id)[:8], e)

    if not new_tracks:
        log.warning("refill_playlist: no new tracks generated for playlist %s", str(pl.id)[:8])
        return

    # Append new tracks to JSONB BEFORE queuing (tracked even if queue fails)
    async with AsyncSessionLocal() as db:
        pl_obj = await db.get(type(pl), pl.id)
        if not pl_obj:
            return
        updated_songs = list(pl_obj.songs or []) + new_tracks
        pl_obj.songs = updated_songs
        _fm(pl_obj, "songs")
        await db.commit()

    log.info("refill_playlist: added %d tracks to playlist %s (slot=%s)", len(new_tracks), str(pl.id)[:8], pl.slot)

    # Queue downloads for new tracks
    try:
        from .downloader import queue_downloads
        await queue_downloads(new_tracks, playlist_id=str(pl.id))
    except Exception as e:
        log.error("refill_playlist: queue_downloads failed for playlist %s: %s", str(pl.id)[:8], e)


async def run_discovery() -> None:
    """Entry point called by nightly job — regenerates consumed slots for profiles with daily_auto_generate."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Profile).where(
                Profile.is_catchall == False,  # noqa: E712
                Profile.daily_auto_generate == True,  # noqa: E712
            )
        )
        profiles = result.scalars().all()

    for profile in profiles:
        try:
            await generate_for_profile(str(profile.id))
        except Exception as e:
            log.error("Discovery failed for profile %s: %s", profile.name, e)
