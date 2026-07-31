import asyncio
import logging
import signal

import grpc
from grpc_health.v1 import health_pb2_grpc
from grpc_health.v1._async import HealthServicer

from src.config import settings

logger = logging.getLogger(__name__)


def create_server(port: str = settings.PORT) -> tuple[grpc.aio.Server, HealthServicer]:
    server = grpc.aio.server()
    server.add_insecure_port(f"[::]:{port}")

    health_servicer = HealthServicer()
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)

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
    server, health_servicer = create_server()
    handle_graceful_shutdown(server, health_servicer)
    try:
        await server.start()
        await server.wait_for_termination()
    finally:
        await server.stop(grace=None)


if __name__ == "__main__":
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass
