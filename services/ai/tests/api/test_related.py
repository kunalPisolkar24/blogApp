from uuid import uuid4

import grpc
import pytest

from src.config import settings
from src.generated import ai_service_pb2
from src.generated import ai_service_pb2_grpc as ai_stubs
from tests.scripted_embedding import ScriptedEmbedding


def _index_request(post_id: str, text: str) -> ai_service_pb2.IndexRequest:
    return ai_service_pb2.IndexRequest(
        post_id=post_id,
        title=text,
        body=f"<p>{text}</p>",
        summary=f"summary {text}",
        tags=["tutorial"],
        created_at="2026-01-01T00:00:00Z",
    )


def _related_request(post_id: str, limit: int | None = None) -> ai_service_pb2.RelatedRequest:
    return ai_service_pb2.RelatedRequest(
        post_id=post_id, limit=limit if limit is not None else 10
    )


async def test_related_returns_similar_posts(stub) -> None:
    target = str(uuid4())
    similar = str(uuid4())
    await stub.IndexPost(_index_request(target, "beta doc"))
    await stub.IndexPost(_index_request(similar, "beta doc"))
    await stub.IndexPost(_index_request(str(uuid4()), "alpha doc"))

    response = await stub.RelatedPosts(_related_request(target))

    assert response.post_ids == [similar]


async def test_related_excludes_the_post_itself(stub) -> None:
    post_id = str(uuid4())
    await stub.IndexPost(_index_request(post_id, "beta doc"))

    response = await stub.RelatedPosts(_related_request(post_id))

    assert response.post_ids == []


async def test_related_returns_empty_for_unknown_post(stub) -> None:
    await stub.IndexPost(_index_request(str(uuid4()), "beta doc"))

    response = await stub.RelatedPosts(_related_request(str(uuid4())))

    assert response.post_ids == []


async def test_related_returns_empty_for_deleted_post(stub) -> None:
    post_id = str(uuid4())
    await stub.IndexPost(_index_request(post_id, "beta doc"))
    await stub.DeletePost(ai_service_pb2.DeleteRequest(post_id=post_id))

    response = await stub.RelatedPosts(_related_request(post_id))

    assert response.post_ids == []


async def test_related_respects_limit(stub) -> None:
    target = str(uuid4())
    await stub.IndexPost(_index_request(target, "beta doc"))
    for _ in range(3):
        await stub.IndexPost(_index_request(str(uuid4()), "beta doc"))

    response = await stub.RelatedPosts(_related_request(target, limit=2))

    assert len(response.post_ids) == 2


async def test_related_defaults_limit_to_ten(running_server_factory) -> None:
    channel, _, _ = await running_server_factory(ScriptedEmbedding())
    stub = ai_stubs.AIServiceStub(channel)
    target = str(uuid4())
    await stub.IndexPost(_index_request(target, "beta doc"))
    for _ in range(11):
        await stub.IndexPost(_index_request(str(uuid4()), "beta doc"))

    response = await stub.RelatedPosts(_related_request(target))

    assert len(response.post_ids) == settings.RELATED_DEFAULT_LIMIT


async def test_related_rejects_empty_post_id(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.RelatedPosts(_related_request(""))

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_related_rejects_excessive_limit(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.RelatedPosts(_related_request(str(uuid4()), limit=101))

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT
