from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid5

"""Search tests against the real container: qdrant + gRPC end to end.

The service runs with fake embeddings (deterministic unit-norm vectors),
so exact text matches score ~1.0 and unrelated text ~0.0 — enough for
the dense score threshold to behave like it does with a real model.
"""

import httpx
import pytest

from src.generated import ai_service_pb2

pytestmark = pytest.mark.container


def _index(
    service,
    post_id: str,
    title: str,
    body: str = "<p>body</p>",
    created_at: datetime = datetime(2026, 1, 1, tzinfo=UTC),
) -> None:
    service.stub.IndexPost(
        ai_service_pb2.IndexRequest(
            post_id=post_id,
            title=title,
            body=body,
            created_at=created_at,
        )
    )


def test_search_finds_semantic_match(service) -> None:
    _index(service, "6a75a41221a9752ec47bc601", "Kubernetes deployment guide")

    response = service.stub.SearchPosts(
        ai_service_pb2.SearchRequest(
            query="Kubernetes deployment guide", offset=0, limit=10
        )
    )

    assert "6a75a41221a9752ec47bc601" in response.post_ids
    assert response.total >= 1


def test_search_ranks_exact_match_first(service) -> None:
    _index(service, "6a75a41221a9752ec47bc602", "Scaling Kafka Consumers")
    _index(service, "6a75a41221a9752ec47bc603", "Italian pasta recipes")

    response = service.stub.SearchPosts(
        ai_service_pb2.SearchRequest(
            query="Scaling Kafka Consumers", offset=0, limit=10
        )
    )

    assert response.post_ids[0] == "6a75a41221a9752ec47bc602"


def test_search_filters_gibberish(service) -> None:
    _index(
        service, "6a75a41221a9752ec47bc604", "Distributed tracing with opentelemetry"
    )

    response = service.stub.SearchPosts(
        ai_service_pb2.SearchRequest(query="x7k9l2m4n6p8q1r3", offset=0, limit=10)
    )

    assert response.post_ids == []
    assert response.total == 0


def test_search_filters_irrelevant_semantic_match(service) -> None:
    _index(
        service, "6a75a41221a9752ec47bc605", "Distributed tracing with opentelemetry"
    )

    # No word of this query appears in any indexed post, so only the
    # dense channel is in play and the threshold must reject it.
    response = service.stub.SearchPosts(
        ai_service_pb2.SearchRequest(
            query="quantum chromodynamics of soup", offset=0, limit=10
        )
    )

    assert response.post_ids == []
    assert response.total == 0


def test_related_finds_similar_posts(service) -> None:
    _index(service, "6a75a41221a9752ec47bc606", "Kubernetes deployment guide")
    _index(service, "6a75a41221a9752ec47bc607", "Kubernetes deployment guide")
    _index(service, "6a75a41221a9752ec47bc608", "Italian pasta recipes")

    response = service.stub.RelatedPosts(
        ai_service_pb2.RelatedRequest(post_id="6a75a41221a9752ec47bc606", limit=10)
    )

    # The collection is shared with the search tests, so assert on the
    # properties of the result rather than its exact contents.
    assert "6a75a41221a9752ec47bc607" in response.post_ids
    assert "6a75a41221a9752ec47bc608" not in response.post_ids


def test_related_excludes_the_post_itself(service) -> None:
    _index(service, "6a75a41221a9752ec47bc609", "Scaling Kafka Consumers")

    response = service.stub.RelatedPosts(
        ai_service_pb2.RelatedRequest(post_id="6a75a41221a9752ec47bc609", limit=10)
    )

    assert "6a75a41221a9752ec47bc609" not in response.post_ids


def test_startup_creates_posts_and_users_collections(service, qdrant) -> None:
    host = qdrant.get_container_host_ip()
    port = qdrant.get_exposed_port(6333)

    response = httpx.get(f"http://{host}:{port}/collections")

    assert response.status_code == 200
    names = {
        collection["name"] for collection in response.json()["result"]["collections"]
    }
    assert {"posts", "users"} <= names


def test_update_user_profile_writes_a_user_point(service, qdrant) -> None:
    post_id = "6a75a41221a9752ec47bc60a"
    user_id = "11111111-1111-1111-1111-111111111111"
    _index(service, post_id, "Kubernetes deployment guide")

    service.stub.UpdateUserProfile(
        ai_service_pb2.UserProfileUpdateRequest(
            user_id=user_id,
            post_id=post_id,
            kind=ai_service_pb2.INTERACTION_KIND_VIEW,
        )
    )

    host = qdrant.get_container_host_ip()
    port = qdrant.get_exposed_port(6333)
    response = httpx.post(
        f"http://{host}:{port}/collections/users/points/scroll",
        json={"limit": 10},
    )

    assert response.status_code == 200
    points = response.json()["result"]["points"]
    assert len(points) == 1
    assert points[0]["id"] == str(uuid5(NAMESPACE_URL, user_id))
    payload = points[0]["payload"]
    assert payload["total_weight"] == 1.0
    assert payload["tag_weights"] == {}
    assert payload["seen_post_ids"] == [post_id]


def test_recommend_feed_ranks_and_filters_posts(service) -> None:
    target = "6a75a41221a9752ec47bc60b"
    similar = "6a75a41221a9752ec47bc60c"
    user_id = "11111111-1111-1111-1111-111111111111"
    _index(service, target, "Kubernetes deployment guide", created_at=datetime.now(UTC))
    _index(
        service, similar, "Kubernetes deployment guide", created_at=datetime.now(UTC)
    )
    _index(
        service,
        "6a75a41221a9752ec47bc60d",
        "Italian pasta recipes",
        created_at=datetime.now(UTC),
    )
    service.stub.UpdateUserProfile(
        ai_service_pb2.UserProfileUpdateRequest(
            user_id=user_id,
            post_id=target,
            kind=ai_service_pb2.INTERACTION_KIND_VIEW,
        )
    )

    response = service.stub.RecommendFeed(
        ai_service_pb2.RecommendRequest(user_id=user_id, offset=0, limit=10)
    )

    # The similar post ranks, the interacted post is excluded as seen,
    # and the unrelated post stays below the score threshold. Older
    # posts indexed by other tests fall outside the recency window.
    assert response.post_ids == [similar]
    assert response.total == 1
