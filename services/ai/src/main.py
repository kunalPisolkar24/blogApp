import asyncio
import logging
import signal

import grpc
from grpc_health.v1 import health_pb2, health_pb2_grpc
from grpc_health.v1._async import HealthServicer
from prometheus_client import start_http_server

from src.api.service import AIService
from src.config import settings
from src.generated import ai_service_pb2_grpc
from src.llm import FakeLLMClient, LLMClient
from src.logging import setup_logging
from src.tracing import setup_tracing

logger = logging.getLogger(__name__)


async def create_server(
    service: AIService,
    port: str | None = None,
) -> tuple[grpc.aio.Server, HealthServicer]:
    server = grpc.aio.server()
    server.add_insecure_port(f"[::]:{port or settings.PORT}")

    health_servicer = HealthServicer()
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)

    ai_service_pb2_grpc.add_AIServiceServicer_to_server(service, server)
    await health_servicer.set("ai.AIService", health_pb2.HealthCheckResponse.SERVING)

    return server, health_servicer


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
    server, health_servicer = await create_server(AIService(llm))
    handle_graceful_shutdown(server, health_servicer)
    try:
        await server.start()
        await server.wait_for_termination()
    finally:
        await llm.close()
        await server.stop(grace=None)


if __name__ == "__main__":
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass
