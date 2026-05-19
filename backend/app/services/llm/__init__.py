from .base import LLMProvider
from .claude import ClaudeProvider
from .ollama import OllamaProvider
from ...core.config import get_settings


def get_llm_provider() -> LLMProvider:
    settings = get_settings()
    if settings.LLM_PROVIDER == "ollama":
        return OllamaProvider()
    return ClaudeProvider()
