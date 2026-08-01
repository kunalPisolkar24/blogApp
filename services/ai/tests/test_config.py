import pathlib

import pytest
from pydantic import ValidationError

from src.config import Settings


@pytest.fixture
def isolated_settings(tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.chdir(tmp_path)
    return Settings()


def test_default_port(isolated_settings: Settings) -> None:
    assert isolated_settings.PORT == "50051"


def test_default_grace_seconds(isolated_settings: Settings) -> None:
    assert isolated_settings.GRACE_SECONDS == 5


def test_default_llm_settings(isolated_settings: Settings) -> None:
    assert (
        isolated_settings.LLM_API_URL == "https://lightning.ai/api/v1/chat/completions"
    )
    assert isolated_settings.LLM_MODEL == "lightning-ai/gpt-oss-20b"
    assert isolated_settings.LLM_TIMEOUT_SECONDS == 60


def test_llm_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_MODEL", "some-other-model")
    monkeypatch.setenv("LLM_TIMEOUT_SECONDS", "30")

    settings = Settings()

    assert settings.LLM_MODEL == "some-other-model"
    assert settings.LLM_TIMEOUT_SECONDS == 30


def test_default_max_post_chars(isolated_settings: Settings) -> None:
    assert isolated_settings.MAX_POST_CHARS == 5000


def test_max_post_chars_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAX_POST_CHARS", "10000")

    assert Settings().MAX_POST_CHARS == 10000


def test_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PORT", "50055")
    monkeypatch.setenv("GRACE_SECONDS", "9")

    settings = Settings()

    assert settings.PORT == "50055"
    assert settings.GRACE_SECONDS == 9


def test_invalid_grace_seconds_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GRACE_SECONDS", "abc")

    with pytest.raises(ValidationError):
        Settings()
