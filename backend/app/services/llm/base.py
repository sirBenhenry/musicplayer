from typing import Protocol, runtime_checkable


@runtime_checkable
class LLMProvider(Protocol):
    async def complete(self, messages: list[dict], tools: list[dict] | None = None) -> str:
        ...
