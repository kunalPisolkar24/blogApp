import asyncio
import logging

import grpc

from src.config import settings

logger = logging.getLogger(__name__)


def create_server() -> grpc.aio.Server:
    server = grpc.aio.server()
    server.add_insecure_port(f"[::]:{settings.PORT}")
    return server


async def serve() -> None:
    server = create_server()
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
