"""Sync Navidrome library → local DB. Upserts artists, albums, songs."""
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..core.database import AsyncSessionLocal
from ..models.library import Artist, Album, Song
from ..services import navidrome

log = logging.getLogger(__name__)


async def run_library_sync() -> dict:
    log.info("Library sync started")
    counts = {"artists": 0, "albums": 0, "songs": 0}

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

        # --- Albums + Songs (iterate all artists) ---
        result = await db.execute(select(Artist))
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
                    set_={"title": al["name"], "year": al.get("year")},
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
                    stmt = pg_insert(Song).values(
                        navidrome_id=s["id"],
                        title=s["title"],
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
                            "duration_sec": s.get("duration"),
                            "file_path": s.get("path"),
                            "updated_at": datetime.now(timezone.utc),
                        },
                    )
                    await db.execute(stmt)
                    counts["songs"] += 1

            await db.commit()

    log.info("Library sync complete: %s", counts)
    return counts
