import asyncio
import logging

import grpc

from src.config import settings

logger = logging.getLogger(__name__)


async def serve() -> None:
    server = grpc.aio.server()
    listen_addr = f"[::]:{settings.PORT}"
    server.add_insecure_port(listen_addr)

    logger.info("AI service starting on %s", listen_addr)
    await server.start()
    await server.wait_for_termination()


if __name__ == "__main__":
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass
