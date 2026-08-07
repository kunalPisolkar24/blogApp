import grpc
import pytest
from qdrant_client import AsyncQdrantClient

from src.api.server import create_server
from src.api.service import AIService
from src.embeddings import FakeEmbeddingClient
from src.generated import ai_service_pb2_grpc as ai_stubs
from src.vector import SearchIndex
from tests.fake_llm import FakeLLM


@pytest.fixture
def fake_llm() -> FakeLLM:
    return FakeLLM()


@pytest.fixture
async def search_index() -> SearchIndex:
    index = SearchIndex(FakeEmbeddingClient(), AsyncQdrantClient(location=":memory:"))
    await index.ensure_collection()
    yield index
    await index.close()


@pytest.fixture
async def running_server(
    unused_tcp_port: int, fake_llm: FakeLLM, search_index: SearchIndex
):
    server, health_servicer = await create_server(
        AIService(fake_llm, search_index), str(unused_tcp_port)
    )
    await server.start()
    channel = grpc.aio.insecure_channel(f"127.0.0.1:{unused_tcp_port}")
    await channel.channel_ready()

    yield channel, health_servicer

    await channel.close()
    await server.stop(grace=None)


@pytest.fixture
def stub(running_server) -> ai_stubs.AIServiceStub:
    channel, _ = running_server
    return ai_stubs.AIServiceStub(channel)
