from datetime import UTC, datetime
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
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def _related_request(
    post_id: str, limit: int | None = None
) -> ai_service_pb2.RelatedRequest:
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


def _related_batch_request(
    post_ids: list[str], limit: int | None = None
) -> ai_service_pb2.RelatedBatchRequest:
    return ai_service_pb2.RelatedBatchRequest(
        post_ids=post_ids, limit=limit if limit is not None else 10
    )


async def test_related_includes_indexed_total(stub) -> None:
    target = str(uuid4())
    await stub.IndexPost(_index_request(target, "beta doc"))
    await stub.IndexPost(_index_request(str(uuid4()), "beta doc"))

    response = await stub.RelatedPosts(_related_request(target))

    assert response.total == 2, "total must count the indexed post pool"


async def test_related_total_zero_when_nothing_indexed(stub) -> None:
    response = await stub.RelatedPosts(_related_request(str(uuid4())))

    assert response.total == 0


async def test_related_batch_returns_one_item_per_post(stub) -> None:
    first = str(uuid4())
    second = str(uuid4())
    similar = str(uuid4())
    await stub.IndexPost(_index_request(first, "beta doc"))
    await stub.IndexPost(_index_request(second, "beta doc"))
    await stub.IndexPost(_index_request(similar, "beta doc"))

    response = await stub.RelatedPostsBatch(
        _related_batch_request([first, second], limit=5)
    )

    assert len(response.results) == 2
    by_id = {item.post_id: item for item in response.results}
    assert similar in by_id[first].related_post_ids
    assert similar in by_id[second].related_post_ids
    assert first not in by_id[first].related_post_ids
    assert second not in by_id[second].related_post_ids
    assert by_id[first].total == 3


async def test_related_batch_unknown_posts_get_empty_items(stub) -> None:
    await stub.IndexPost(_index_request(str(uuid4()), "beta doc"))

    response = await stub.RelatedPostsBatch(
        _related_batch_request([str(uuid4()), str(uuid4())])
    )

    assert len(response.results) == 2
    for item in response.results:
        assert item.related_post_ids == []


async def test_related_batch_respects_limit(stub) -> None:
    target = str(uuid4())
    await stub.IndexPost(_index_request(target, "beta doc"))
    for _ in range(4):
        await stub.IndexPost(_index_request(str(uuid4()), "beta doc"))

    response = await stub.RelatedPostsBatch(_related_batch_request([target], limit=2))

    assert len(response.results[0].related_post_ids) == 2


async def test_related_batch_rejects_empty_post_ids(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.RelatedPostsBatch(_related_batch_request([]))

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_related_batch_rejects_blank_post_id(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.RelatedPostsBatch(_related_batch_request(["", str(uuid4())]))

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_related_batch_rejects_excessive_limit(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.RelatedPostsBatch(_related_batch_request([str(uuid4())], limit=101))

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT
