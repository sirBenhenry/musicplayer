import anthropic

from ...core.config import get_settings

settings = get_settings()


class ClaudeProvider:
    def __init__(self):
        self._client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    async def complete(self, messages: list[dict], tools: list[dict] | None = None) -> str:
        kwargs = {
            "model": "claude-sonnet-4-6",
            "max_tokens": 2048,
            "messages": messages,
        }
        if tools:
            kwargs["tools"] = tools

        response = await self._client.messages.create(**kwargs)

        # Extract text content from response
        for block in response.content:
            if block.type == "text":
                return block.text
        return ""
