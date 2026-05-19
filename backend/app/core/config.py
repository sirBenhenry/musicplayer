from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://musicapp:changeme@postgres:5432/musicapp"

    # JWT auth
    JWT_SECRET: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 30  # 30 days

    # Single user credentials
    APP_USERNAME: str = "ben"
    APP_PASSWORD: str = "changeme"

    # Navidrome
    NAVIDROME_URL: str = "http://navidrome:4533"
    NAVIDROME_USER: str = ""
    NAVIDROME_PASS: str = ""

    # Lidarr
    LIDARR_URL: str = "http://lidarr:8686"
    LIDARR_KEY: str = ""

    # qBittorrent (aniapp stack, accessed via host IP)
    QBITTORRENT_URL: str = "http://10.1.8.4:8080"
    QBITTORRENT_USER: str = "admin"
    QBITTORRENT_PASS: str = ""

    # Prowlarr (aniapp stack)
    PROWLARR_URL: str = "http://10.1.8.4:9696"
    PROWLARR_KEY: str = ""

    # LLM
    ANTHROPIC_API_KEY: str = ""
    LLM_PROVIDER: str = "claude"  # claude | ollama
    OLLAMA_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3.1:70b"

    # Music discovery APIs
    LASTFM_API_KEY: str = ""
    LASTFM_API_SECRET: str = ""
    LISTENBRAINZ_TOKEN: str = ""

    # Filesystem paths (inside container)
    MUSIC_DIR: str = "/data/music/media/music"
    DOWNLOADS_DIR: str = "/data/music/torrents/music"

    # Discovery behaviour
    SKIP_THRESHOLD: float = 0.90
    DAILY_GENERATION_CRON: str = "0 2 * * *"  # 02:00 server time
    EOD_CRON: str = "45 23 * * *"             # 23:45 server time
    LIBRARY_SYNC_CRON: str = "0 * * * *"      # every hour

    # CORS — Tailscale subnet + local dev
    CORS_ORIGINS: list[str] = ["http://localhost:8081", "http://10.0.0.0/8"]

    TZ: str = "Europe/Zurich"


@lru_cache
def get_settings() -> Settings:
    return Settings()
