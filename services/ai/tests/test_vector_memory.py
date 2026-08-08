"""Unit tests for MemoryIndex, the in-memory twin of SearchIndex.

The index must reproduce the Qdrant path's semantics without a store:
dense similarity gated by the score threshold, hybrid matching via the
sparse channel, and related-posts behaviour (self excluded, ranked by
similarity, unknown posts yield nothing). Fake embeddings keep every
score deterministic.
"""

import hashlib
import math

import pytest

from src.embeddings import FakeEmbeddingClient
from src.vector import MemoryIndex

TITLE_POSTS = [
    (
        "6a75a41221a9752ec47bc6df",
        "Running Ollama Locally",
        "How to run ollama on your own machine.",
    ),
    (
        "6a75a41221a9752ec47bc6e0",
        "Qdrant Vector Search Guide",
        "Hybrid search with dense and sparse vectors.",
    ),
    (
        "6a75a41221a9752ec47bc6e1",
        "Redis Caching Patterns",
        "Cache invalidation strategies with redis.",
    ),
    (
        "6a75a41221a9752ec47bc6e2",
        "Scaling Kafka Consumers",
        "Consumer groups and rebalancing at scale.",
    ),
    (
        "6a75a41221a9752ec47bc6e4",
        "Kubernetes Deployment Guide",
        "Deploying containers to a kubernetes cluster.",
    ),
]


@pytest.fixture
async def index() -> MemoryIndex:
    index = MemoryIndex(FakeEmbeddingClient())
    yield index
    await index.close()


class _BagOfWordsEmbeddings:
    """Vectors where shared words mean similar vectors, so tests can
    exercise graded similarity instead of the fake client's 0-or-1."""

    async def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for text in texts:
            vector = [0.0] * 32
            for token in set(text.lower().split()):
                index = int(hashlib.sha256(token.encode()).hexdigest(), 16) % 32
                vector[index] += 1.0
            norm = math.sqrt(sum(component**2 for component in vector))
            vectors.append([component / norm for component in vector])
        return vectors

    async def close(self) -> None:
        return None


async def _seed(index: MemoryIndex, posts: list[tuple[str, str, str]]) -> None:
    for post_id, title, body in posts:
        await index.upsert(post_id, title, body, "", [], "2026-01-01T00:00:00Z")


async def test_ensure_collection_is_a_noop(index: MemoryIndex) -> None:
    await index.ensure_collection()


async def test_exact_text_match_surfaces_above_threshold(index: MemoryIndex) -> None:
    await _seed(index, TITLE_POSTS)

    result = await index.search("Redis Caching Patterns", 0, 10)

    assert "6a75a41221a9752ec47bc6e1" in result.post_ids
    assert result.total >= 1


async def test_gibberish_query_yields_no_results(index: MemoryIndex) -> None:
    await _seed(index, TITLE_POSTS)

    result = await index.search("x7k9l2m4n6p8q1r3", 0, 10)

    assert result.post_ids == []
    assert result.total == 0


async def test_sparse_channel_matches_paraphrased_query(index: MemoryIndex) -> None:
    """The query shares no words verbatim, so only token overlap finds it."""
    await _seed(index, TITLE_POSTS)

    result = await index.search("kubernetes deployment", 0, 10)

    assert "6a75a41221a9752ec47bc6e4" in result.post_ids


async def test_pagination_slices_the_stable_ranking(index: MemoryIndex) -> None:
    await _seed(index, TITLE_POSTS)
    query = "Running Ollama Locally Redis Caching Patterns Kubernetes Deployment Guide"

    first_page = await index.search(query, 0, 2)
    second_page = await index.search(query, 2, 2)

    assert (
        first_page.post_ids + second_page.post_ids
        == (await index.search(query, 0, 10)).post_ids[:4]
    )
    assert len(first_page.post_ids) == 2


async def test_related_excludes_the_post_itself(index: MemoryIndex) -> None:
    await _seed(index, TITLE_POSTS)

    related = await index.related("6a75a41221a9752ec47bc6e0", 10)

    assert "6a75a41221a9752ec47bc6e0" not in related
    assert len(related) <= 10


async def test_related_prefers_similar_posts(index: MemoryIndex) -> None:
    twin_id = "6a75a41221a9752ec47bc6e0"
    similar_id = "6a75a41221a9752ec47bc6e5"
    await _seed(index, TITLE_POSTS)
    await index.upsert(
        similar_id,
        "Qdrant Vector Search Guide",
        "Hybrid search with dense and sparse vectors.",
        "",
        [],
        "",
    )

    related = await index.related(twin_id, 10)

    assert related[0] == similar_id


async def test_related_ranks_more_similar_posts_first() -> None:
    index = MemoryIndex(_BagOfWordsEmbeddings())
    await index.upsert("post-a", "kafka consumers", "", "", [], "")
    await index.upsert("post-b", "kafka consumers guide", "", "", [], "")
    await index.upsert("post-d", "kafka", "", "", [], "")
    await index.upsert("post-c", "italian pasta", "", "", [], "")

    related = await index.related("post-a", 10)

    # Both kafka posts clear the threshold; the one sharing more words
    # must rank first, and the unrelated post must be filtered out.
    assert related == ["post-b", "post-d"]


async def test_related_unknown_post_yields_empty(index: MemoryIndex) -> None:
    await _seed(index, TITLE_POSTS)

    assert await index.related("000000000000000000000000", 10) == []


async def test_delete_removes_the_post(index: MemoryIndex) -> None:
    await _seed(index, TITLE_POSTS)

    await index.delete("6a75a41221a9752ec47bc6e1")
    result = await index.search("Redis Caching Patterns", 0, 10)

    assert "6a75a41221a9752ec47bc6e1" not in result.post_ids
