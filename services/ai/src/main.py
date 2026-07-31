import asyncio
import logging
import signal

import grpc

from src.config import settings

logger = logging.getLogger(__name__)


def create_server() -> grpc.aio.Server:
    server = grpc.aio.server()
    server.add_insecure_port(f"[::]:{settings.PORT}")
    return server


def handle_graceful_shutdown(server: grpc.aio.Server, grace: int = settings.GRACE_SECONDS) -> None:
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(server.stop(grace=grace)))


async def serve() -> None:
    server = create_server()
    handle_graceful_shutdown(server)
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
