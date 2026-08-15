import grpc
import pytest

from src.config import settings
from src.generated import ai_service_pb2
from src.generated import ai_service_pb2_grpc as ai_stubs
from tests.scripted_embedding import ScriptedEmbedding


def _embed_request(text: str) -> ai_service_pb2.EmbedRequest:
    return ai_service_pb2.EmbedRequest(text=text)


async def test_embed_returns_expected_dimension(stub) -> None:
    response = await stub.Embed(_embed_request("alpha doc"))

    assert len(response.vector) == settings.QDRANT_VECTOR_SIZE


async def test_embed_is_deterministic(stub) -> None:
    first = await stub.Embed(_embed_request("alpha doc"))
    second = await stub.Embed(_embed_request("alpha doc"))

    assert first.vector == second.vector


async def test_embed_embeds_through_the_requested_provider(
    running_server_factory,
) -> None:
    channel, _, _ = await running_server_factory(ScriptedEmbedding())
    stub = ai_stubs.AIServiceStub(channel)

    response = await stub.Embed(_embed_request("beta doc"))

    assert response.vector == ScriptedEmbedding._unit(1)


async def test_embed_rejects_empty_text(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.Embed(_embed_request("   "))

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_embed_rejects_excessive_text(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.Embed(_embed_request("x" * (settings.SEARCH_MAX_QUERY_CHARS + 1)))

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT
