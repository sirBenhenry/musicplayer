import asyncio
import httpx

SLSKD_URL = "http://slskd:5030"
HEADERS = {"X-API-Key": "musicapp-api-key-2024x"}

async def main():
    async with httpx.AsyncClient(timeout=10, headers=HEADERS) as client:
        for path in ["/api/v1/server", "/api/v1/searches", "/health", "/api/v0/server/state"]:
            r = await client.get(f"{SLSKD_URL}{path}")
            print(f"{path}: {r.status_code} | {r.text[:200]}")
            print()

asyncio.run(main())
