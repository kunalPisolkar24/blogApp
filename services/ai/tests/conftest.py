import grpc
import pytest

from src.main import create_server
from src.service import AIService
from tests.fake_llm import FakeLLM


@pytest.fixture
def fake_llm() -> FakeLLM:
    return FakeLLM()


@pytest.fixture
async def running_server(unused_tcp_port: int, fake_llm: FakeLLM):
    server, health_servicer = await create_server(
        AIService(fake_llm), str(unused_tcp_port)
    )
    await server.start()
    channel = grpc.aio.insecure_channel(f"127.0.0.1:{unused_tcp_port}")

    yield channel, health_servicer

    await channel.close()
    await server.stop(grace=None)
