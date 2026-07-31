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
