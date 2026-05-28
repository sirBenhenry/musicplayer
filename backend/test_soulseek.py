"""Test soulseek search directly to diagnose 0-results issue."""
import asyncio
import httpx
import os

SLSKD_URL = "http://slskd:5030"
SLSKD_KEY = "musicapp-api-key-2024x"
HEADERS = {"X-API-Key": SLSKD_KEY}

AUDIO_EXTS = frozenset([".flac", ".mp3", ".m4a", ".aac", ".opus", ".ogg"])

async def main():
    query = "Ado RuLe"
    print(f"Searching slskd for: {query!r}")

    async with httpx.AsyncClient(timeout=15, headers=HEADERS) as client:
        r = await client.post(f"{SLSKD_URL}/api/v1/searches", json={"searchText": query})
        print(f"Search start: {r.status_code}")
        if r.status_code not in (200, 201):
            print("FAILED:", r.text[:500])
            return
        search_id = r.json()["id"]
        print(f"Search ID: {search_id}")

    for poll in range(20):  # poll up to 100s
        await asyncio.sleep(5)
        async with httpx.AsyncClient(timeout=15, headers=HEADERS) as client:
            r = await client.get(f"{SLSKD_URL}/api/v1/searches/{search_id}?includeResponses=true")
            data = r.json()

        state = data.get("state", "")
        responses = data.get("responses", [])
        total_files = sum(len(resp.get("files", [])) for resp in responses)
        audio_files = sum(
            1 for resp in responses for f in resp.get("files", [])
            if os.path.splitext(f.get("filename", "").lower())[1] in AUDIO_EXTS
            and f.get("size", 0) >= 2_000_000
        )
        print(f"  poll {poll+1}: state={state!r}, peers={len(responses)}, "
              f"total_files={total_files}, audio_files={audio_files}")

        if "Completed" in state or "Cancelled" in state:
            print("Search finished.")
            break
        if audio_files >= 15 and poll >= 2:
            print("Early exit: enough audio files found.")
            break

    # Print first few audio candidates
    print("\n=== Audio candidates ===")
    count = 0
    for resp in responses:
        username = resp.get("username", "")
        for f in resp.get("files", []):
            fname = f.get("filename", "")
            size = f.get("size", 0)
            ext = os.path.splitext(fname.lower())[1]
            if ext in AUDIO_EXTS and size >= 2_000_000:
                print(f"  [{username}] {fname} ({size//1024//1024}MB)")
                count += 1
                if count >= 10:
                    break
        if count >= 10:
            break

    if count == 0:
        print("  (none found)")

    # Cleanup
    async with httpx.AsyncClient(timeout=5, headers=HEADERS) as client:
        await client.delete(f"{SLSKD_URL}/api/v1/searches/{search_id}")
    print("Search cleaned up.")

asyncio.run(main())
