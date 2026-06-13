import asyncio, asyncpg, json

async def main():
    conn = await asyncpg.connect("postgresql://musicapp:musicapp_db_pass_2024@postgres:5432/musicapp")
    rows = await conn.fetch(
        "SELECT artist, title, source_used, pipeline_log FROM download_jobs "
        "WHERE status='completed' ORDER BY created_at DESC LIMIT 5"
    )
    for r in rows:
        log = json.loads(r['pipeline_log'] or '[]')
        for step in log:
            if step.get('step') == 'sources_searched':
                per = step.get('data', {}).get('per_source', {})
                print(f"{r['artist']} - {r['title']} [{r['source_used']}]")
                for src, result in per.items():
                    print(f"  {src}: {result}")
                break
    await conn.close()

asyncio.run(main())
