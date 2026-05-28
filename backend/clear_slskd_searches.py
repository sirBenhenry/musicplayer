"""Clear all pending/queued searches from slskd to unclog the queue."""
import asyncio
import httpx

SLSKD_URL = "http://slskd:5030"
HEADERS = {"X-API-Key": "musicapp-api-key-2024x"}

async def main():
    async with httpx.AsyncClient(timeout=15, headers=HEADERS) as client:
        r = await client.get(f"{SLSKD_URL}/api/v1/searches")
        searches = r.json()
        print(f"Total searches in slskd: {len(searches)}")

        cleared = 0
        # Delete ALL searches in batches to unclog slskd
        for s in searches:
            sid = s.get("id")
            try:
                dr = await client.delete(f"{SLSKD_URL}/api/v1/searches/{sid}")
                cleared += 1
            except Exception as e:
                print(f"  failed {sid[:8]}: {e}")

        print(f"\nCleared {cleared} pending searches.")

asyncio.run(main())
