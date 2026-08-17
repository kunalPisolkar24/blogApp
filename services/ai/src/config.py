from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PORT: str = "50051"
    GRACE_SECONDS: int = 5
    METRICS_PORT: int = 12666
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    LLM_MODE: Literal["real", "fake"] = "real"
    LLM_API_URL: str = "https://lightning.ai/api/v1/chat/completions"
    LLM_API_KEY: str = ""
    LLM_MODEL: str = "lightning-ai/gpt-oss-20b"
    LLM_TIMEOUT_SECONDS: int = 60
    MAX_POST_CHARS: int = 5000
    MAX_INPUT_CHARS: int = 5000
    MAX_BODY_CHARS: int = 3000
    MAX_TITLE_CHARS: int = 200
    OTEL_EXPORTER_OTLP_ENDPOINT: str = ""
    OTEL_SERVICE_NAME: str = "ai-service"

    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: str = ""
    QDRANT_COLLECTION: str = "posts"
    # User interest profiles: one point per user with their dense taste
    # vector and sparse tag weights. Same vector config as the posts
    # collection.
    QDRANT_USERS_COLLECTION: str = "users"
    QDRANT_VECTOR_SIZE: int = 1024
    QDRANT_TIMEOUT_SECONDS: int = 10
    # Attempts, 5s apart, before failing startup when Qdrant is unreachable.
    QDRANT_STARTUP_RETRIES: int = 12
    SEARCH_MAX_RESULT_WINDOW: int = 1000
    SEARCH_MAX_QUERY_CHARS: int = 512
    SEARCH_MAX_LIMIT: int = 100
    # Default number of related posts returned when the request omits limit.
    RELATED_DEFAULT_LIMIT: int = 10
    # Minimum dense cosine similarity for a point to be a search result.
    # Keeps semantically unrelated text (e.g. gibberish queries) from
    # surfacing as "best matches"; tune per embedding model.
    SEARCH_DENSE_SCORE_THRESHOLD: float = 0.3

    # Grounded chat: how many posts to retrieve, how much conversation to
    # consider, and the total excerpt budget fed to the LLM per turn.
    CHAT_TOP_K_DEFAULT: int = 5
    CHAT_MAX_TOP_K: int = 10
    CHAT_MAX_HISTORY_TURNS: int = 6
    CHAT_MAX_CONTEXT_CHARS: int = 12000

    EMBEDDING_MODE: Literal["fake", "ollama"] = "fake"
    EMBEDDING_URL: str = "http://embedding-service:11434"
    EMBEDDING_MODEL: str = "snowflake-arctic-embed2:568m"
    EMBEDDING_BATCH_SIZE: int = 64
    EMBEDDING_MAX_CHARS: int = 8000
    EMBEDDING_TIMEOUT_SECONDS: int = 30

    # Which vector store backs search and related posts. "qdrant" is the
    # real store; "fake" runs a deterministic in-memory index with the
    # same semantics, for docker-free local dev and cheap load tests.
    VECTOR_MODE: Literal["fake", "qdrant"] = "qdrant"

    SPARSE_MIN_TOKEN_LENGTH: int = 2
    SPARSE_PREFIX_MIN_LENGTH: int = 3
    SPARSE_MAX_TOKENS: int = 512

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
