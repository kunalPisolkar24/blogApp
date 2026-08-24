import grpc
import pytest
from langgraph.checkpoint.memory import InMemorySaver
from qdrant_client import AsyncQdrantClient

from src.api.server import create_server
from src.api.service import AIService
from src.embeddings import FakeEmbeddingClient
from src.generated import ai_service_pb2_grpc as ai_stubs
from src.graphs.chat_graph import ChatGraphs, build_chat_graph
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
    chat_graphs = ChatGraphs(
        sessioned=build_chat_graph(
            fake_llm, search_index, FakeEmbeddingClient(), checkpointer=InMemorySaver()
        ),
        stateless=build_chat_graph(fake_llm, search_index, FakeEmbeddingClient()),
    )
    server, health_servicer = await create_server(
        AIService(
            fake_llm,
            search_index,
            FakeEmbeddingClient(),
            chat_graphs=chat_graphs,
        ),
        str(unused_tcp_port),
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


@pytest.fixture
async def agent_server(unused_tcp_port: int, search_index: SearchIndex):
    """Server wired with the feed agent in scripted-fake mode."""
    from src.graphs.feed_graph import FeedAgent

    llm = FakeLLM(response="fresh")
    chat_graphs = ChatGraphs(
        sessioned=build_chat_graph(
            llm, search_index, FakeEmbeddingClient(), checkpointer=InMemorySaver()
        ),
        stateless=build_chat_graph(llm, search_index, FakeEmbeddingClient()),
    )
    server, _health_servicer = await create_server(
        AIService(
            llm,
            search_index,
            FakeEmbeddingClient(),
            chat_graphs=chat_graphs,
            feed_agent=FeedAgent(llm, search_index),
        ),
        str(unused_tcp_port),
    )
    await server.start()
    channel = grpc.aio.insecure_channel(f"127.0.0.1:{unused_tcp_port}")
    await channel.channel_ready()

    yield channel

    await channel.close()
    await server.stop(grace=None)


@pytest.fixture
def agent_stub(agent_server) -> ai_stubs.AIServiceStub:
    return ai_stubs.AIServiceStub(agent_server)


@pytest.fixture
async def running_server_factory(fake_llm: FakeLLM, unused_tcp_port: int):
    """Builds a running gRPC server backed by a custom embedding provider."""

    # A running grpc.aio.Server is torn down when it is garbage collected,
    # so each created server is pinned to this list until the test ends and
    # then stopped explicitly, instead of relying on callers to keep a
    # reference to it.
    servers: list[grpc.aio.Server] = []

    async def make(embeddings) -> tuple[grpc.aio.Channel, SearchIndex, object]:
        index = SearchIndex(embeddings, AsyncQdrantClient(location=":memory:"))
        await index.ensure_collection()
        chat_graphs = ChatGraphs(
            sessioned=build_chat_graph(
                fake_llm, index, embeddings, checkpointer=InMemorySaver()
            ),
            stateless=build_chat_graph(fake_llm, index, embeddings),
        )
        server, _ = await create_server(
            AIService(fake_llm, index, embeddings, chat_graphs=chat_graphs),
            str(unused_tcp_port),
        )
        await server.start()
        channel = grpc.aio.insecure_channel(f"127.0.0.1:{unused_tcp_port}")
        await channel.channel_ready()
        servers.append(server)
        # The server is returned alongside the channel so it stays alive
        # for the duration of the test.
        return channel, index, server

    yield make

    for server in servers:
        await server.stop(grace=None)
