import asyncio
import httpx

SLSKD_URL = "http://slskd:5030"
HEADERS = {"X-API-Key": "musicapp-api-key-2024x"}

async def main():
    async with httpx.AsyncClient(timeout=10, headers=HEADERS) as client:
        # Check application status
        r = await client.get(f"{SLSKD_URL}/api/v1/application")
        print(f"=== Application ({r.status_code}) ===")
        print(f"  body: {r.text[:300]}")

        # Check connection to Soulseek
        r2 = await client.get(f"{SLSKD_URL}/api/v1/server")
        print("\n=== Server ===")
        s = r2.json()
        print(f"  address: {s.get('address')}")
        print(f"  state: {s.get('state')}")
        print(f"  connected: {s.get('isConnected')}")

        # List pending searches
        r3 = await client.get(f"{SLSKD_URL}/api/v1/searches")
        print(f"\n=== Searches ({len(r3.json())} pending) ===")
        for srch in r3.json()[:10]:
            print(f"  id={srch.get('id')[:8]} state={srch.get('state')} q={srch.get('searchText','')[:40]}")

asyncio.run(main())
