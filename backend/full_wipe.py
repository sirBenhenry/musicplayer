"""Full wipe: delete all music files + DB content, keep only catchall profile."""
import asyncio
import os
import shutil
import asyncpg

DSN = "postgresql://musicapp:musicapp_db_pass_2024@postgres:5432/musicapp"
MUSIC_DIR = "/data/music/media/music"


async def main():
    conn = await asyncpg.connect(DSN)

    # Keep only catchall profile
    kept = await conn.fetchrow("SELECT id, name FROM profiles WHERE is_catchall = true LIMIT 1")
    if kept:
        print(f"Keeping profile: {kept['name']} ({kept['id']})")
    else:
        print("WARNING: no catchall profile found — keeping all profiles")

    print("\nWiping DB tables...")
    tables = [
        "download_jobs",
        "song_events",
        "pending_deletions",
        "rejected_songs",
        "user_notifications",
        "playlist_history",
        "genre_history",
        "daily_playlists",
        "user_playlists",
        "songs",
        "albums",
        "artists",
    ]
    for t in tables:
        try:
            await conn.execute(f"TRUNCATE {t} CASCADE")
            print(f"  {t}: truncated")
        except Exception as e:
            print(f"  {t}: error — {e}")

    # Delete non-catchall profiles
    if kept:
        await conn.execute(
            "DELETE FROM profiles WHERE is_catchall = false OR is_catchall IS NULL"
        )
        remaining = await conn.fetchval("SELECT COUNT(*) FROM profiles")
        print(f"\nProfiles: {remaining} remain (catchall only)")

    await conn.close()
    print("DB wipe done.")

    # Wipe music files
    print(f"\nWiping {MUSIC_DIR}...")
    deleted_files = 0
    deleted_dirs = 0
    if os.path.isdir(MUSIC_DIR):
        for entry in os.scandir(MUSIC_DIR):
            try:
                if entry.is_dir(follow_symlinks=False):
                    shutil.rmtree(entry.path)
                    deleted_dirs += 1
                else:
                    os.unlink(entry.path)
                    deleted_files += 1
            except Exception as e:
                print(f"  skip {entry.name}: {e}")
    print(f"  deleted {deleted_files} files, {deleted_dirs} directories")
    print("\nWipe complete.")


asyncio.run(main())
