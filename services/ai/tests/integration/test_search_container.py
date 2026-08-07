"""Search tests against the real container: qdrant + gRPC end to end.

The service runs with fake embeddings (deterministic unit-norm vectors),
so exact text matches score ~1.0 and unrelated text ~0.0 — enough for
the dense score threshold to behave like it does with a real model.
"""

import pytest

from src.generated import ai_service_pb2

pytestmark = pytest.mark.container


def _index(
    service,
    post_id: str,
    title: str,
    body: str = "<p>body</p>",
) -> None:
    service.stub.IndexPost(
        ai_service_pb2.IndexRequest(
            post_id=post_id,
            title=title,
            body=body,
            created_at="2026-01-01T00:00:00Z",
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
        ai_service_pb2.RelatedRequest(
            post_id="6a75a41221a9752ec47bc606", limit=10
        )
    )

    # The collection is shared with the search tests, so assert on the
    # properties of the result rather than its exact contents.
    assert "6a75a41221a9752ec47bc607" in response.post_ids
    assert "6a75a41221a9752ec47bc608" not in response.post_ids


def test_related_excludes_the_post_itself(service) -> None:
    _index(service, "6a75a41221a9752ec47bc609", "Scaling Kafka Consumers")

    response = service.stub.RelatedPosts(
        ai_service_pb2.RelatedRequest(
            post_id="6a75a41221a9752ec47bc609", limit=10
        )
    )

    assert "6a75a41221a9752ec47bc609" not in response.post_ids
