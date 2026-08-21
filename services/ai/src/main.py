import asyncio
import logging
import signal

import grpc
from grpc_health.v1._async import HealthServicer
from langgraph.checkpoint.base import BaseCheckpointSaver
from prometheus_client import start_http_server

from src.api.server import create_server
from src.api.service import AIService
from src.config import settings
from src.embeddings import FakeEmbeddingClient, OllamaEmbeddingClient
from src.graphs.checkpointer import (
    build_checkpointer,
    close_checkpointer,
    start_checkpointer,
)
from src.llm import FakeLLMClient, LLMClient
from src.observability.langsmith import setup_langsmith
from src.observability.logging import setup_logging
from src.observability.tracing import setup_tracing
from src.vector import MemoryIndex, SearchIndex, SearchStore

logger = logging.getLogger(__name__)


def handle_graceful_shutdown(
    server: grpc.aio.Server,
    health_servicer: HealthServicer,
    grace: int = settings.GRACE_SECONDS,
) -> None:
    async def _shutdown() -> None:
        await health_servicer.enter_graceful_shutdown()
        await server.stop(grace=grace)

    def shutdown() -> None:
        asyncio.create_task(_shutdown())

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, shutdown)


async def _ensure_search_ready(search: SearchStore) -> None:
    """Wait for Qdrant with a short backoff instead of crashing on a
    transient startup blip (e.g. the store still restarting)."""
    for attempt in range(1, settings.QDRANT_STARTUP_RETRIES + 1):
        try:
            await search.ensure_collection()
            return
        except Exception:
            if attempt == settings.QDRANT_STARTUP_RETRIES:
                raise
            logger.warning(
                "qdrant not ready, retrying (%d/%d)",
                attempt,
                settings.QDRANT_STARTUP_RETRIES,
            )
            await asyncio.sleep(5)


async def _ensure_checkpointer_ready(saver: BaseCheckpointSaver) -> None:
    """Wait for the checkpoint store with a short backoff instead of
    crashing on a transient startup blip (e.g. Postgres still booting)."""
    for attempt in range(1, settings.CHECKPOINT_STARTUP_RETRIES + 1):
        try:
            await start_checkpointer(saver)
            return
        except Exception:
            if attempt == settings.CHECKPOINT_STARTUP_RETRIES:
                raise
            logger.warning(
                "checkpoint store not ready, retrying (%d/%d)",
                attempt,
                settings.CHECKPOINT_STARTUP_RETRIES,
            )
            await asyncio.sleep(5)


async def serve() -> None:
    setup_logging()
    setup_tracing()
    setup_langsmith()
    logger.info("AI service starting")

    start_http_server(settings.METRICS_PORT)
    logger.info("prometheus metrics exposed on port %s", settings.METRICS_PORT)

    llm = FakeLLMClient() if settings.LLM_MODE == "fake" else LLMClient()
    embeddings = (
        FakeEmbeddingClient()
        if settings.EMBEDDING_MODE == "fake"
        else OllamaEmbeddingClient()
    )
    search: SearchStore = (
        MemoryIndex(embeddings)
        if settings.VECTOR_MODE == "fake"
        else SearchIndex(embeddings)
    )
    await _ensure_search_ready(search)

    checkpointer = build_checkpointer()
    await _ensure_checkpointer_ready(checkpointer)

    server, health_servicer = await create_server(AIService(llm, search, embeddings))
    handle_graceful_shutdown(server, health_servicer)
    try:
        await server.start()
        await server.wait_for_termination()
    finally:
        await close_checkpointer(checkpointer)
        await llm.close()
        await search.close()
        await embeddings.close()
        await server.stop(grace=None)


if __name__ == "__main__":
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass
