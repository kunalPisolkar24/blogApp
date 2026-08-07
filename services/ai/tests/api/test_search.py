from uuid import uuid4

import grpc
import pytest

from src.config import settings
from src.generated import ai_service_pb2
from src.generated import ai_service_pb2_grpc as ai_stubs


class ScriptedEmbedding:
    """Embedding provider with two hand-crafted unit vectors.

    Documents containing "beta" map to axis 1, everything else to axis 0,
    so the cosine similarity between the two groups is exactly 0 and
    within a group exactly 1.
    """

    async def embed(self, texts: list[str]) -> list[list[float]]:
        vectors = []
        for text in texts:
            vectors.append(self._unit(1 if "beta" in text else 0))
        return vectors

    async def close(self) -> None:
        return None

    @staticmethod
    def _unit(axis: int) -> list[float]:
        vector = [0.0] * settings.QDRANT_VECTOR_SIZE
        vector[axis] = 1.0
        return vector


def _index_request(post_id: str | None = None) -> ai_service_pb2.IndexRequest:
    return ai_service_pb2.IndexRequest(
        post_id=post_id if post_id is not None else str(uuid4()),
        title="gRPC client setup guide",
        body="<p>How to configure a gRPC client with keepalive options.</p>",
        summary="A short summary",
        tags=["grpc", "tutorial"],
        created_at="2026-01-01T00:00:00Z",
    )


async def test_index_and_search_roundtrip(stub) -> None:
    post_id = str(uuid4())

    await stub.IndexPost(_index_request(post_id))

    response = await stub.SearchPosts(
        ai_service_pb2.SearchRequest(query="grpc client", offset=0, limit=10)
    )
    assert response.post_ids == [post_id]
    assert response.total == 1


async def test_index_and_search_roundtrip_objectid_hex(stub) -> None:
    post_id = "6a75a41221a9752ec47bc6df"

    await stub.IndexPost(_index_request(post_id))

    response = await stub.SearchPosts(
        ai_service_pb2.SearchRequest(query="grpc client", offset=0, limit=10)
    )
    assert response.post_ids == [post_id]
    assert response.total == 1


async def test_search_keeps_relevant_semantic_matches(running_server_factory) -> None:
    channel, _, _ = await running_server_factory(ScriptedEmbedding())
    stub = ai_stubs.AIServiceStub(channel)
    alpha = str(uuid4())
    beta = str(uuid4())
    await stub.IndexPost(
        ai_service_pb2.IndexRequest(post_id=alpha, title="Alpha document", body="<p>alpha body</p>")
    )
    await stub.IndexPost(
        ai_service_pb2.IndexRequest(post_id=beta, title="Beta document", body="<p>beta body</p>")
    )

    response = await stub.SearchPosts(
        ai_service_pb2.SearchRequest(query="alpha", offset=0, limit=10)
    )

    assert response.post_ids == [alpha]
    assert response.total == 1


async def test_search_ignores_irrelevant_semantic_matches(running_server_factory) -> None:
    channel, _, _ = await running_server_factory(ScriptedEmbedding())
    stub = ai_stubs.AIServiceStub(channel)
    await stub.IndexPost(
        ai_service_pb2.IndexRequest(
            post_id=str(uuid4()), title="Beta document", body="<p>beta body</p>"
        )
    )

    response = await stub.SearchPosts(
        ai_service_pb2.SearchRequest(query="alpha", offset=0, limit=10)
    )

    assert response.post_ids == []
    assert response.total == 0


async def test_search_does_not_return_deleted_post(stub) -> None:
    post_id = str(uuid4())
    await stub.IndexPost(_index_request(post_id))

    await stub.DeletePost(ai_service_pb2.DeleteRequest(post_id=post_id))

    response = await stub.SearchPosts(
        ai_service_pb2.SearchRequest(query="grpc client", offset=0, limit=10)
    )
    assert response.post_ids == []
    assert response.total == 0


async def test_search_ranks_sparse_lexical_match(stub) -> None:
    target = str(uuid4())
    other = str(uuid4())
    await stub.IndexPost(
        ai_service_pb2.IndexRequest(
            post_id=target, title="Kubernetes deployment guide", body="<p>k8s</p>"
        )
    )
    await stub.IndexPost(
        ai_service_pb2.IndexRequest(
            post_id=other, title="Recipe for sourdough bread", body="<p>baking</p>"
        )
    )

    response = await stub.SearchPosts(
        ai_service_pb2.SearchRequest(query="kubernetes", offset=0, limit=10)
    )

    assert response.post_ids[0] == target


async def test_search_ranks_dense_semantic_match(stub) -> None:
    target = str(uuid4())
    other = str(uuid4())
    await stub.IndexPost(
        ai_service_pb2.IndexRequest(
            post_id=target, title="Distributed tracing", body="<p>otel</p>"
        )
    )
    await stub.IndexPost(
        ai_service_pb2.IndexRequest(
            post_id=other, title="Italian pasta recipes", body="<p>food</p>"
        )
    )

    response = await stub.SearchPosts(
        ai_service_pb2.SearchRequest(query="distributed tracing", offset=0, limit=10)
    )

    assert response.post_ids[0] == target


async def test_search_pagination(stub) -> None:
    ids = [str(uuid4()) for _ in range(3)]
    for post_id in ids:
        await stub.IndexPost(_index_request(post_id))

    page_one = await stub.SearchPosts(
        ai_service_pb2.SearchRequest(query="grpc client", offset=0, limit=2)
    )
    page_two = await stub.SearchPosts(
        ai_service_pb2.SearchRequest(query="grpc client", offset=2, limit=2)
    )

    assert len(page_one.post_ids) == 2
    assert len(page_two.post_ids) == 1
    assert set(page_one.post_ids) | set(page_two.post_ids) == set(ids)


async def test_index_rejects_empty_post_id(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.IndexPost(_index_request(post_id=""))

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_delete_rejects_empty_post_id(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.DeletePost(ai_service_pb2.DeleteRequest(post_id=""))

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_search_rejects_empty_query(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.SearchPosts(
            ai_service_pb2.SearchRequest(query="   ", offset=0, limit=10)
        )

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_search_rejects_long_query(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.SearchPosts(
            ai_service_pb2.SearchRequest(query="x" * 513, offset=0, limit=10)
        )

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_search_rejects_excessive_limit(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.SearchPosts(
            ai_service_pb2.SearchRequest(query="hello", offset=0, limit=101)
        )

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_search_rejects_window_beyond_cap(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.SearchPosts(
            ai_service_pb2.SearchRequest(query="hello", offset=990, limit=100)
        )

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_search_defaults_limit_to_ten(stub) -> None:
    response = await stub.SearchPosts(
        ai_service_pb2.SearchRequest(query="hello", offset=0)
    )

    assert response.total == 0
