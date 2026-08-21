import os

import pytest

from src.llm import FakeLLMClient, LLMClient
from src.observability.langsmith import setup_langsmith


@pytest.fixture
def clean_langsmith_env(monkeypatch: pytest.MonkeyPatch):
    for var in ("LANGSMITH_TRACING", "LANGSMITH_API_KEY", "LANGSMITH_PROJECT"):
        monkeypatch.delenv(var, raising=False)


def test_disabled_sets_no_env(
    monkeypatch: pytest.MonkeyPatch, clean_langsmith_env
) -> None:
    monkeypatch.setattr("src.config.settings.LANGCHAIN_TRACING", False)

    setup_langsmith()

    assert "LANGSMITH_TRACING" not in os.environ


def test_enabled_bridges_settings_to_env(
    monkeypatch: pytest.MonkeyPatch, clean_langsmith_env
) -> None:
    monkeypatch.setattr("src.config.settings.LANGCHAIN_TRACING", True)
    monkeypatch.setattr("src.config.settings.LANGCHAIN_API_KEY", "lsv2_test")
    monkeypatch.setattr("src.config.settings.LANGCHAIN_PROJECT", "proj")

    setup_langsmith()

    assert os.environ["LANGSMITH_TRACING"] == "true"
    assert os.environ["LANGSMITH_API_KEY"] == "lsv2_test"
    assert os.environ["LANGSMITH_PROJECT"] == "proj"


def test_enabled_without_key_and_project_only_sets_tracing(
    monkeypatch: pytest.MonkeyPatch, clean_langsmith_env
) -> None:
    monkeypatch.setattr("src.config.settings.LANGCHAIN_TRACING", True)
    monkeypatch.setattr("src.config.settings.LANGCHAIN_API_KEY", "")
    monkeypatch.setattr("src.config.settings.LANGCHAIN_PROJECT", "")

    setup_langsmith()

    assert os.environ["LANGSMITH_TRACING"] == "true"
    assert "LANGSMITH_API_KEY" not in os.environ
    assert "LANGSMITH_PROJECT" not in os.environ


@pytest.mark.parametrize("client", [LLMClient, FakeLLMClient], ids=["real", "fake"])
@pytest.mark.parametrize("method", ["generate_completion", "generate_stream"])
def test_llm_provider_methods_are_traceable(client, method: str) -> None:
    assert hasattr(getattr(client, method), "__wrapped__")
