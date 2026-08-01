from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PORT: str = "50051"
    GRACE_SECONDS: int = 5
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    LLM_API_URL: str = "https://lightning.ai/api/v1/chat/completions"
    LLM_API_KEY: str = ""
    LLM_MODEL: str = "lightning-ai/gpt-oss-20b"
    LLM_TIMEOUT_SECONDS: int = 60
    MAX_POST_CHARS: int = 5000
    MAX_INPUT_CHARS: int = 5000
    MAX_BODY_CHARS: int = 3000

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
