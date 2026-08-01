import grpc
import pytest

from src.main import create_server


@pytest.fixture
async def running_server(unused_tcp_port: int):
    server, health_servicer = await create_server(str(unused_tcp_port))
    await server.start()
    channel = grpc.aio.insecure_channel(f"127.0.0.1:{unused_tcp_port}")

    yield channel, health_servicer

    await channel.close()
    await server.stop(grace=None)
