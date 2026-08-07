import pathlib

import pytest
from pydantic import ValidationError

from src.config import Settings


@pytest.fixture
def isolated_settings(tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.chdir(tmp_path)
    return Settings()


DEFAULTS = {
    "PORT": "50051",
    "GRACE_SECONDS": 5,
    "METRICS_PORT": 12666,
    "LOG_LEVEL": "INFO",
    "LLM_API_URL": "https://lightning.ai/api/v1/chat/completions",
    "LLM_API_KEY": "",
    "LLM_MODEL": "lightning-ai/gpt-oss-20b",
    "LLM_TIMEOUT_SECONDS": 60,
    "MAX_POST_CHARS": 5000,
    "MAX_INPUT_CHARS": 5000,
    "MAX_BODY_CHARS": 3000,
    "MAX_TITLE_CHARS": 200,
    "OTEL_EXPORTER_OTLP_ENDPOINT": "",
    "OTEL_SERVICE_NAME": "ai-service",
    "QDRANT_URL": "http://localhost:6333",
    "QDRANT_VECTOR_SIZE": 1024,
    "QDRANT_STARTUP_RETRIES": 12,
    "SEARCH_DENSE_SCORE_THRESHOLD": 0.3,
}


@pytest.mark.parametrize("field,expected", DEFAULTS.items())
def test_defaults(isolated_settings: Settings, field: str, expected) -> None:
    assert getattr(isolated_settings, field) == expected


OVERRIDES = {
    "PORT": "50055",
    "GRACE_SECONDS": 9,
    "METRICS_PORT": 9091,
    "LOG_LEVEL": "WARNING",
    "LLM_API_KEY": "test-key",
    "LLM_MODEL": "some-other-model",
    "LLM_TIMEOUT_SECONDS": 30,
    "MAX_POST_CHARS": 10000,
    "MAX_INPUT_CHARS": 10000,
    "MAX_BODY_CHARS": 1000,
    "MAX_TITLE_CHARS": 100,
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://collector:4317",
    "OTEL_SERVICE_NAME": "ai-test",
    "QDRANT_URL": "http://qdrant:6333",
    "QDRANT_VECTOR_SIZE": 768,
    "QDRANT_STARTUP_RETRIES": 3,
    "SEARCH_DENSE_SCORE_THRESHOLD": 0.55,
}


@pytest.mark.parametrize("field,value", OVERRIDES.items())
def test_env_override(monkeypatch: pytest.MonkeyPatch, field: str, value) -> None:
    monkeypatch.setenv(field, str(value))

    assert getattr(Settings(), field) == value


def test_invalid_grace_seconds_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GRACE_SECONDS", "abc")

    with pytest.raises(ValidationError):
        Settings()
