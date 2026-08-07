import asyncio
import logging
import signal

import grpc
from grpc_health.v1._async import HealthServicer
from prometheus_client import start_http_server

from src.api.server import create_server
from src.api.service import AIService
from src.config import settings
from src.embeddings import FakeEmbeddingClient, OllamaEmbeddingClient
from src.llm import FakeLLMClient, LLMClient
from src.observability.logging import setup_logging
from src.observability.tracing import setup_tracing
from src.vector import SearchIndex

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


async def serve() -> None:
    setup_logging()
    setup_tracing()
    logger.info("AI service starting")

    start_http_server(settings.METRICS_PORT)
    logger.info("prometheus metrics exposed on port %s", settings.METRICS_PORT)

    llm = FakeLLMClient() if settings.LLM_MODE == "fake" else LLMClient()
    embeddings = (
        FakeEmbeddingClient()
        if settings.EMBEDDING_MODE == "fake"
        else OllamaEmbeddingClient()
    )
    search = SearchIndex(embeddings)
    await search.ensure_collection()

    server, health_servicer = await create_server(AIService(llm, search))
    handle_graceful_shutdown(server, health_servicer)
    try:
        await server.start()
        await server.wait_for_termination()
    finally:
        await llm.close()
        await search.close()
        await embeddings.close()
        await server.stop(grace=None)


if __name__ == "__main__":
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass
