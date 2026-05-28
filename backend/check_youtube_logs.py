import asyncio
import asyncpg

async def main():
    conn = await asyncpg.connect("postgresql://musicapp:musicapp_db_pass_2024@postgres:5432/musicapp")
    rows = await conn.fetch(
        "SELECT artist, title, source_used, pipeline_log FROM download_jobs "
        "WHERE status='completed' AND source_used='youtube' "
        "ORDER BY created_at DESC LIMIT 2"
    )
    for r in rows:
        print(f"=== {r['artist']} - {r['title']} ===")
        log = r['pipeline_log'] or ""
        print(log[-4000:])
        print()
    await conn.close()

asyncio.run(main())
