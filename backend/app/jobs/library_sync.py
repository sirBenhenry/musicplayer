"""Sync Navidrome library → local DB. Upserts artists, albums, songs."""
import logging
from datetime import datetime, timezone

from sqlalchemy import func as sa_func, select, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert

_kks = None

def _romanize(text: str) -> str | None:
    """Return pykakasi hepburn romanization, or None if text is already ASCII or conversion fails."""
    if text.isascii():
        return None
    global _kks
    try:
        if _kks is None:
            import pykakasi
            _kks = pykakasi.kakasi()
        result = "".join(item["hepburn"] for item in _kks.convert(text)).strip()
        return result if result else None
    except Exception:
        return None

from ..core.database import AsyncSessionLocal
from ..models.library import Artist, Album, Song
from ..services import navidrome

log = logging.getLogger(__name__)


async def run_library_sync() -> dict:
    log.info("Library sync started")
    counts = {"artists": 0, "albums": 0, "songs": 0, "removed": 0}
    seen_song_ids: set[str] = set()

    async with AsyncSessionLocal() as db:
        # --- Artists ---
        raw_artists = await navidrome.get_artists()
        for a in raw_artists:
            stmt = pg_insert(Artist).values(
                navidrome_id=a["id"],
                name=a["name"],
                added_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            ).on_conflict_do_update(
                index_elements=["navidrome_id"],
                set_={"name": a["name"], "updated_at": datetime.now(timezone.utc)},
            )
            await db.execute(stmt)
            counts["artists"] += 1

        await db.commit()

        # --- Merge placeholder artists (created during import with navidrome_id="mb:{mbid}") ---
        # Find any placeholder records, then merge their followed/lidarr_id into the real record by name.
        placeholder_result = await db.execute(
            select(Artist).where(Artist.navidrome_id.like("mb:%"))
        )
        placeholders = placeholder_result.scalars().all()
        for ph in placeholders:
            from sqlalchemy import func as _func
            real_result = await db.execute(
                select(Artist).where(
                    _func.lower(Artist.name) == ph.name.lower(),
                    Artist.navidrome_id.not_like("mb:%"),
                )
            )
            real = real_result.scalar_one_or_none()
            if real:
                if ph.followed:
                    real.followed = True
                if ph.lidarr_id and not real.lidarr_id:
                    real.lidarr_id = ph.lidarr_id
                if ph.musicbrainz_id and not real.musicbrainz_id:
                    real.musicbrainz_id = ph.musicbrainz_id
                await db.delete(ph)
                log.info("library_sync: merged placeholder artist '%s' into real record", ph.name)
        await db.commit()

        # --- Albums + Songs (iterate all artists) ---
        result = await db.execute(select(Artist).where(Artist.navidrome_id.not_like("mb:%")))
        db_artists = {a.navidrome_id: a for a in result.scalars().all()}

        for nav_id, artist in db_artists.items():
            try:
                artist_detail = await navidrome.get_artist(nav_id)
            except Exception as e:
                log.warning("Failed to fetch artist %s: %s", nav_id, e)
                continue

            for al in artist_detail.get("album", []):
                stmt = pg_insert(Album).values(
                    navidrome_id=al["id"],
                    title=al["name"],
                    artist_id=artist.id,
                    year=al.get("year"),
                    cover_url=al.get("coverArt"),
                    added_at=datetime.now(timezone.utc),
                ).on_conflict_do_update(
                    index_elements=["navidrome_id"],
                    set_={"title": al["name"], "year": al.get("year"), "cover_url": al.get("coverArt")},
                )
                await db.execute(stmt)
                counts["albums"] += 1

                try:
                    album_detail = await navidrome.get_album(al["id"])
                except Exception as e:
                    log.warning("Failed to fetch album %s: %s", al["id"], e)
                    continue

                result2 = await db.execute(select(Album).where(Album.navidrome_id == al["id"]))
                db_album = result2.scalar_one_or_none()

                for s in album_detail.get("song", []):
                    seen_song_ids.add(s["id"])
                    rom = _romanize(s["title"])
                    # Song-level artist (may differ from album artist for feat. tracks)
                    song_display_artist = s.get("displayArtist") or s.get("artist") or None
                    stmt = pg_insert(Song).values(
                        navidrome_id=s["id"],
                        title=s["title"],
                        title_romanized=rom,
                        display_artist=song_display_artist,
                        artist_id=artist.id,
                        album_id=db_album.id if db_album else None,
                        duration_sec=s.get("duration"),
                        file_path=s.get("path"),
                        added_at=datetime.now(timezone.utc),
                        updated_at=datetime.now(timezone.utc),
                    ).on_conflict_do_update(
                        index_elements=["navidrome_id"],
                        set_={
                            "title": s["title"],
                            # Preserve MB-sourced romanized title; only set pykakasi if column is NULL
                            "title_romanized": Song.__table__.c.title_romanized if rom is None
                                else sa_func.coalesce(Song.__table__.c.title_romanized, rom),
                            "display_artist": song_display_artist,
                            "artist_id": artist.id,
                            "album_id": db_album.id if db_album else None,
                            "duration_sec": s.get("duration"),
                            "file_path": s.get("path"),
                            "updated_at": datetime.now(timezone.utc),
                        },
                    )
                    await db.execute(stmt)
                    counts["songs"] += 1

            await db.commit()

        # --- Cleanup stale songs (no longer in Navidrome) ---
        if seen_song_ids:
            all_songs = await db.execute(select(Song.id, Song.navidrome_id, Song.title))
            stale = [(row.id, row.navidrome_id, row.title) for row in all_songs if row.navidrome_id not in seen_song_ids]
            if stale:
                stale_ids = [row[0] for row in stale]
                for sid, snid, stitle in stale:
                    log.info("library_sync: removing stale song '%s' (navidrome_id=%s)", stitle, snid)
                await db.execute(delete(Song).where(Song.id.in_(stale_ids)))
                await db.commit()
                counts["removed"] = len(stale)

    log.info("Library sync complete: %s", counts)
    return counts
