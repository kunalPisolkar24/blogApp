from datetime import UTC, datetime
from uuid import uuid4

import grpc
import pytest

from src.config import settings
from src.generated import ai_service_pb2


def _index_request(post_id: str, text: str) -> ai_service_pb2.IndexRequest:
    return ai_service_pb2.IndexRequest(
        post_id=post_id,
        title=text,
        body=f"<p>{text}</p>",
        summary=f"summary {text}",
        tags=["go"],
        created_at=datetime.now(UTC),
    )


def _recommend_request(
    user_id: str,
    offset: int = 0,
    limit: int | None = None,
    mode: int = ai_service_pb2.RECOMMEND_MODE_UNSPECIFIED,
) -> ai_service_pb2.RecommendRequest:
    return ai_service_pb2.RecommendRequest(
        user_id=user_id,
        offset=offset,
        limit=limit if limit is not None else 10,
        mode=mode,
    )


async def _seed_profile(stub, user_id: str, post_id: str) -> None:
    await stub.UpdateUserProfile(
        ai_service_pb2.UserProfileUpdateRequest(
            user_id=user_id, post_id=post_id, kind=ai_service_pb2.INTERACTION_KIND_VIEW
        )
    )


async def test_recommend_feed_returns_ranked_posts(stub) -> None:
    target = str(uuid4())
    similar = str(uuid4())
    await stub.IndexPost(_index_request(target, "beta doc"))
    await stub.IndexPost(_index_request(similar, "beta doc"))
    await stub.IndexPost(_index_request(str(uuid4()), "alpha doc"))
    await _seed_profile(stub, "user-1", target)

    response = await stub.RecommendFeed(_recommend_request("user-1"))

    assert response.post_ids == [similar]
    assert response.total == 1


async def test_recommend_feed_returns_empty_for_cold_start_user(stub) -> None:
    await stub.IndexPost(_index_request(str(uuid4()), "beta doc"))

    response = await stub.RecommendFeed(_recommend_request("user-1"))

    assert response.post_ids == []
    assert response.total == 0


async def test_recommend_feed_accepts_default_mode(stub) -> None:
    await stub.IndexPost(_index_request(str(uuid4()), "beta doc"))

    response = await stub.RecommendFeed(
        _recommend_request("user-1", mode=ai_service_pb2.RECOMMEND_MODE_DEFAULT)
    )

    assert response.post_ids == []


async def test_recommend_feed_rejects_empty_user_id(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.RecommendFeed(_recommend_request(""))

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_recommend_feed_rejects_long_user_id(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.RecommendFeed(
            _recommend_request("u" * (settings.PROFILE_MAX_ID_CHARS + 1))
        )

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_recommend_feed_rejects_surprise_mode_for_now(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.RecommendFeed(
            _recommend_request("user-1", mode=ai_service_pb2.RECOMMEND_MODE_SURPRISE)
        )

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_recommend_feed_rejects_excessive_limit(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.RecommendFeed(_recommend_request("user-1", limit=101))

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_recommend_feed_rejects_pagination_window_overflow(stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.RecommendFeed(
            _recommend_request("user-1", offset=settings.SEARCH_MAX_RESULT_WINDOW)
        )

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT
