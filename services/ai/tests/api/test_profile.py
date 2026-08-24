from datetime import UTC, datetime
from uuid import uuid4

import grpc
import pytest

from src.config import settings
from src.generated import ai_service_pb2
from src.vector import SearchIndex


def _index_request(post_id: str, text: str) -> ai_service_pb2.IndexRequest:
    return ai_service_pb2.IndexRequest(
        post_id=post_id,
        title=text,
        body=f"<p>{text}</p>",
        summary=f"summary {text}",
        tags=["go", "grpc"],
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def _profile_request(
    user_id: str, post_id: str, kind: int, source_mode: int = 0
) -> ai_service_pb2.UserProfileUpdateRequest:
    return ai_service_pb2.UserProfileUpdateRequest(
        user_id=user_id,
        post_id=post_id,
        kind=kind,
        source_mode=source_mode,
    )


async def _user_points(search_index: SearchIndex) -> list:
    response = await search_index._client.scroll(
        collection_name=settings.QDRANT_USERS_COLLECTION, limit=10
    )
    return response[0]


async def test_update_user_profile_returns_empty_response(
    stub, search_index: SearchIndex
) -> None:
    post_id = str(uuid4())
    await stub.IndexPost(_index_request(post_id, "beta doc"))

    response = await stub.UpdateUserProfile(
        _profile_request("user-1", post_id, ai_service_pb2.INTERACTION_KIND_VIEW)
    )

    assert response == ai_service_pb2.UserProfileUpdateResponse()


async def test_update_user_profile_folds_weights_for_each_kind(
    stub, search_index: SearchIndex
) -> None:
    post_id = str(uuid4())
    await stub.IndexPost(_index_request(post_id, "beta doc"))

    for kind in (
        ai_service_pb2.INTERACTION_KIND_VIEW,
        ai_service_pb2.INTERACTION_KIND_LIKE,
        ai_service_pb2.INTERACTION_KIND_SAVE,
    ):
        await stub.UpdateUserProfile(_profile_request("user-1", post_id, kind))

    points = await _user_points(search_index)
    assert len(points) == 1
    payload = points[0].payload
    assert payload["total_weight"] == 9.0
    assert payload["tag_weights"] == {"go": 9.0, "grpc": 9.0}


async def test_update_user_profile_folds_surprise_sourced_interactions_at_reduced_weight(
    stub, search_index: SearchIndex
) -> None:
    post_id = str(uuid4())
    await stub.IndexPost(_index_request(post_id, "beta doc"))

    await stub.UpdateUserProfile(
        _profile_request(
            "user-1",
            post_id,
            ai_service_pb2.INTERACTION_KIND_LIKE,
            source_mode=ai_service_pb2.RECOMMEND_MODE_SURPRISE,
        )
    )

    points = await _user_points(search_index)
    payload = points[0].payload
    expected = (
        settings.PROFILE_LIKE_WEIGHT * settings.PROFILE_SURPRISE_FEEDBACK_MULTIPLIER
    )
    assert payload["total_weight"] == pytest.approx(expected)


async def test_update_user_profile_unattributed_keeps_full_weight(
    stub, search_index: SearchIndex
) -> None:
    post_id = str(uuid4())
    await stub.IndexPost(_index_request(post_id, "beta doc"))

    await stub.UpdateUserProfile(
        _profile_request(
            "user-1",
            post_id,
            ai_service_pb2.INTERACTION_KIND_LIKE,
            source_mode=ai_service_pb2.RECOMMEND_MODE_UNSPECIFIED,
        )
    )

    points = await _user_points(search_index)
    assert points[0].payload["total_weight"] == settings.PROFILE_LIKE_WEIGHT


async def test_update_user_profile_rejects_unknown_source_mode(stub) -> None:
    post_id = str(uuid4())
    await stub.IndexPost(_index_request(post_id, "beta doc"))

    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.UpdateUserProfile(
            _profile_request(
                "user-1",
                post_id,
                ai_service_pb2.INTERACTION_KIND_VIEW,
                source_mode=ai_service_pb2.RECOMMEND_MODE_FRESH,
            )
        )

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_update_user_profile_rejects_empty_user_id(
    stub, search_index: SearchIndex
) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.UpdateUserProfile(
            _profile_request("", str(uuid4()), ai_service_pb2.INTERACTION_KIND_VIEW)
        )

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_update_user_profile_rejects_whitespace_user_id(
    stub, search_index: SearchIndex
) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.UpdateUserProfile(
            _profile_request("   ", str(uuid4()), ai_service_pb2.INTERACTION_KIND_VIEW)
        )

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_update_user_profile_rejects_empty_post_id(
    stub, search_index: SearchIndex
) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.UpdateUserProfile(
            _profile_request("user-1", "", ai_service_pb2.INTERACTION_KIND_VIEW)
        )

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_update_user_profile_rejects_unsupported_kind(
    stub, search_index: SearchIndex
) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.UpdateUserProfile(
            _profile_request(
                "user-1", str(uuid4()), ai_service_pb2.INTERACTION_KIND_UNSPECIFIED
            )
        )

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_update_user_profile_rejects_long_user_id(
    stub, search_index: SearchIndex
) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.UpdateUserProfile(
            _profile_request(
                "u" * (settings.PROFILE_MAX_ID_CHARS + 1),
                str(uuid4()),
                ai_service_pb2.INTERACTION_KIND_VIEW,
            )
        )

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_update_user_profile_unknown_post_is_a_noop(
    stub, search_index: SearchIndex
) -> None:
    await stub.IndexPost(_index_request(str(uuid4()), "beta doc"))

    response = await stub.UpdateUserProfile(
        _profile_request("user-1", str(uuid4()), ai_service_pb2.INTERACTION_KIND_VIEW)
    )

    assert response == ai_service_pb2.UserProfileUpdateResponse()
    assert await _user_points(search_index) == []
