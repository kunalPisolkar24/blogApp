"""Checkpointer factory: in-memory for tests, Postgres for real runs.

The chat graphs use LangGraph checkpointing to persist conversation
state per thread. The backend is env-driven via CHECKPOINT_DB_URL: an
empty URL keeps everything in memory (unit tests, docker-free dev),
a URL selects the durable AsyncPostgresSaver.
"""

import logging
from typing import cast

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from src.config import settings
from src.graphs.state import ChatMessage, RelevanceVerdict

logger = logging.getLogger(__name__)

# Small pool: checkpoint writes are short transactions queued per turn,
# so exhaustion just waits briefly rather than needing many connections.
POOL_MIN_SIZE = 1
POOL_MAX_SIZE = 10
POOL_OPEN_TIMEOUT_SECONDS = 30.0

# Our checkpointed dataclasses must be explicitly allowed; without this
# langgraph warns on every load and will block them in a future release,
# degrading stored objects to raw dicts.
_SERDE = JsonPlusSerializer(allowed_msgpack_modules={ChatMessage, RelevanceVerdict})


def build_checkpointer() -> BaseCheckpointSaver:
    if not settings.CHECKPOINT_DB_URL:
        logger.info("checkpoint store: in-memory")
        return InMemorySaver(serde=_SERDE)

    pool = AsyncConnectionPool(
        conninfo=settings.CHECKPOINT_DB_URL,
        min_size=POOL_MIN_SIZE,
        max_size=POOL_MAX_SIZE,
        # Mirror how the saver configures its own connections
        # (from_conn_string): autocommit is required because setup()
        # runs CREATE INDEX CONCURRENTLY, which cannot run inside a
        # transaction block.
        kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
        # Opened explicitly by start_checkpointer so connection failures
        # surface inside the startup retry loop.
        open=False,
    )
    logger.info("checkpoint store: postgres")
    return AsyncPostgresSaver(pool, serde=_SERDE)


async def start_checkpointer(saver: BaseCheckpointSaver) -> None:
    """Open the backing pool and create tables. No-op for in-memory."""
    if not isinstance(saver, AsyncPostgresSaver):
        return
    pool = cast(AsyncConnectionPool, saver.conn)
    await pool.open(wait=True, timeout=POOL_OPEN_TIMEOUT_SECONDS)
    await saver.setup()


async def close_checkpointer(saver: BaseCheckpointSaver) -> None:
    """Release the backing pool. No-op for in-memory."""
    if not isinstance(saver, AsyncPostgresSaver):
        return
    pool = cast(AsyncConnectionPool, saver.conn)
    await pool.close()
