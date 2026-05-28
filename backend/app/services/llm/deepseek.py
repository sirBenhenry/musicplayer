import httpx

from ...core.config import get_settings

settings = get_settings()

_BASE_URL = "https://api.deepseek.com"


class DeepSeekProvider:
    async def complete(self, messages: list[dict], tools: list[dict] | None = None) -> str:
        payload: dict = {
            "model": settings.DEEPSEEK_MODEL,
            "messages": messages,
            "max_tokens": 2048,
        }
        if tools:
            payload["tools"] = tools

        headers = {
            "Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(f"{_BASE_URL}/chat/completions", json=payload, headers=headers)
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"] or ""
