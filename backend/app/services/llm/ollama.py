import httpx

from ...core.config import get_settings

settings = get_settings()


class OllamaProvider:
    async def complete(self, messages: list[dict], tools: list[dict] | None = None) -> str:
        payload = {
            "model": settings.OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
        }
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(f"{settings.OLLAMA_URL}/api/chat", json=payload)
            r.raise_for_status()
            return r.json()["message"]["content"]
