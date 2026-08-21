import asyncio
from typing import Any

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg_pool import AsyncConnectionPool

from src.graphs.checkpointer import (
    build_checkpointer,
    close_checkpointer,
    start_checkpointer,
)
from src.main import _ensure_checkpointer_ready


@pytest.fixture
def no_db(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("src.config.settings.CHECKPOINT_DB_URL", "")


def test_build_memory_when_no_url(no_db) -> None:
    assert isinstance(build_checkpointer(), InMemorySaver)


async def test_build_postgres_when_url_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "src.config.settings.CHECKPOINT_DB_URL",
        "postgresql://ai_checkpointer:pass@localhost:5433/ai_checkpoints",
    )
    saver = build_checkpointer()
    try:
        assert isinstance(saver, AsyncPostgresSaver)
        pool = saver.conn
        assert isinstance(pool, AsyncConnectionPool)
        # Construction must not touch the network; opening is explicit.
        assert pool.closed
    finally:
        await pool.close()


async def test_start_and_close_are_noop_for_memory(no_db) -> None:
    saver = build_checkpointer()
    await start_checkpointer(saver)
    await close_checkpointer(saver)


class FlakyPool:
    """Duck-typed pool whose open() fails until a set number of tries."""

    def __init__(self, failures: int) -> None:
        self.failures = failures
        self.opens = 0
        self.closed = False

    async def open(self, wait: bool = True, timeout: float | None = None) -> None:
        self.opens += 1
        if self.failures > 0:
            self.failures -= 1
            raise ConnectionError("pool not ready")

    async def close(self) -> None:
        self.closed = True


def _postgres_saver_with(pool: Any) -> AsyncPostgresSaver:
    saver = AsyncPostgresSaver(pool)

    async def setup() -> None:
        return None

    saver.setup = setup  # type: ignore[method-assign]
    return saver


async def test_ensure_retries_until_ready(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("src.config.settings.CHECKPOINT_STARTUP_RETRIES", 3)
    monkeypatch.setattr(asyncio, "sleep", _instant_sleep)
    pool = FlakyPool(failures=2)
    saver = _postgres_saver_with(pool)

    await _ensure_checkpointer_ready(saver)

    assert pool.opens == 3


async def test_ensure_raises_after_exhausting_retries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("src.config.settings.CHECKPOINT_STARTUP_RETRIES", 2)
    monkeypatch.setattr(asyncio, "sleep", _instant_sleep)
    pool = FlakyPool(failures=99)
    saver = _postgres_saver_with(pool)

    with pytest.raises(ConnectionError):
        await _ensure_checkpointer_ready(saver)

    assert pool.opens == 2


async def test_close_closes_postgres_pool() -> None:
    pool = FlakyPool(failures=0)
    saver = _postgres_saver_with(pool)

    await close_checkpointer(saver)

    assert pool.closed


async def _instant_sleep(_seconds: float) -> None:
    return None
