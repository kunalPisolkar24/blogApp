from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PORT: str = "50051"
    GRACE_SECONDS: int = 5

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
