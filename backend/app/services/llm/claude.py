import anthropic

from ...core.config import get_settings

settings = get_settings()


class ClaudeProvider:
    def __init__(self):
        self._client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    async def complete(self, messages: list[dict], tools: list[dict] | None = None) -> str:
        # Anthropic takes `system` as a top-level kwarg, not a message role —
        # map a leading system message across (DeepSeek/Ollama accept it inline).
        system_prompt = None
        if messages and messages[0].get("role") == "system":
            system_prompt = messages[0]["content"]
            messages = messages[1:]
        kwargs = {
            "model": "claude-sonnet-4-6",
            "max_tokens": 2048,
            "messages": messages,
        }
        if system_prompt:
            kwargs["system"] = system_prompt
        if tools:
            kwargs["tools"] = tools

        response = await self._client.messages.create(**kwargs)

        # Extract text content from response
        for block in response.content:
            if block.type == "text":
                return block.text
        return ""
