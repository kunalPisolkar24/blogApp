"""Unit tests for MemoryIndex, the in-memory twin of SearchIndex.

The index must reproduce the Qdrant path's semantics without a store:
dense similarity gated by the score threshold, hybrid matching via the
sparse channel, related-posts behaviour (self excluded, ranked by
similarity, unknown posts yield nothing), and user profile folds that
never re-embed. Fake embeddings keep every score deterministic.
"""

import hashlib
import math
from datetime import UTC, datetime, timedelta

import pytest

from src.config import settings
from src.embeddings import FakeEmbeddingClient
from src.vector import MemoryIndex, SearchResult

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


class _CountingEmbeddings(FakeEmbeddingClient):
    """FakeEmbeddingClient that counts how many times it embeds."""

    def __init__(self) -> None:
        super().__init__()
        self.calls = 0

    async def embed(self, texts: list[str]) -> list[list[float]]:
        self.calls += 1
        return await super().embed(texts)


async def _seed_tagged(index: MemoryIndex, post_id: str, text: str) -> None:
    await index.upsert(post_id, text, f"<p>{text}</p>", "", ["go"], "")


async def test_update_user_profile_folds_into_the_profile() -> None:
    index = MemoryIndex(_CountingEmbeddings())
    await _seed_tagged(index, "post-a", "alpha doc")
    await _seed_tagged(index, "post-b", "beta doc")

    await index.update_user_profile("user-1", "post-a", 1.0)
    await index.update_user_profile("user-1", "post-b", 3.0)

    profile = index._profiles["user-1"]
    assert profile.total_weight == 4.0
    assert profile.tag_weights == {"go": 4.0}
    assert profile.seen_post_ids == ["post-a", "post-b"]


async def test_update_user_profile_unknown_post_is_a_noop(index: MemoryIndex) -> None:
    await _seed_tagged(index, "post-a", "beta doc")

    await index.update_user_profile("user-1", "unknown-post", 1.0)

    assert index._profiles == {}


async def test_update_user_profile_never_calls_the_embedding_provider() -> None:
    embeddings = _CountingEmbeddings()
    index = MemoryIndex(embeddings)
    await _seed_tagged(index, "post-a", "beta doc")
    await index.upsert("post-b", "alpha doc", "", "", [], "")

    calls_before = embeddings.calls
    await index.update_user_profile("user-1", "post-a", 1.0)
    await index.update_user_profile("user-1", "post-b", 1.0)

    assert embeddings.calls == calls_before


async def test_update_user_profile_caps_seen_posts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "PROFILE_SEEN_POSTS_CAP", 3)
    index = MemoryIndex(FakeEmbeddingClient())
    for post_id in ("post-a", "post-b", "post-c", "post-d"):
        await _seed_tagged(index, post_id, "beta doc")

    for post_id in ("post-a", "post-b", "post-c", "post-d"):
        await index.update_user_profile("user-1", post_id, 1.0)

    assert index._profiles["user-1"].seen_post_ids == ["post-b", "post-c", "post-d"]


def _fresh_date() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


async def _seed_fresh(index: MemoryIndex, post_id: str, text: str) -> None:
    await index.upsert(post_id, text, f"<p>{text}</p>", "", [], _fresh_date())


async def test_recommend_returns_empty_for_cold_start_user(index: MemoryIndex) -> None:
    await _seed_fresh(index, "post-a", "kafka consumers")

    result = await index.recommend("user-1", 0, 10)

    assert result == SearchResult(post_ids=[], total=0)


async def test_recommend_ranks_by_profile_similarity() -> None:
    index = MemoryIndex(_BagOfWordsEmbeddings())
    await _seed_fresh(index, "post-a", "kafka consumers")
    await _seed_fresh(index, "post-b", "kafka consumers guide")
    await _seed_fresh(index, "post-c", "italian pasta")
    await index.update_user_profile("user-1", "post-a", 1.0)

    result = await index.recommend("user-1", 0, 10)

    # The interacted post is excluded, the similar post ranks first, and
    # the unrelated post stays below the score threshold.
    assert result.post_ids == ["post-b"]
    assert result.total == 1


async def test_recommend_excludes_seen_and_stale_posts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "RECOMMEND_RECENCY_DAYS", 60)
    index = MemoryIndex(FakeEmbeddingClient())
    await _seed_fresh(index, "post-a", "beta doc")
    await index.upsert("post-b", "beta doc", "", "", [], "2026-01-01T00:00:00Z")
    await index.upsert("post-c", "beta doc", "", "", [], "")
    await _seed_fresh(index, "post-d", "beta doc")
    await index.update_user_profile("user-1", "post-a", 1.0)

    result = await index.recommend("user-1", 0, 10)

    assert result.post_ids == ["post-d"]
    assert result.total == 1


async def test_recommend_slices_pagination_with_exact_total() -> None:
    index = MemoryIndex(_BagOfWordsEmbeddings())
    await _seed_fresh(index, "post-a", "kafka consumers")
    await _seed_fresh(index, "post-b", "kafka consumers guide")
    await _seed_fresh(index, "post-d", "kafka consumers deep dive")
    await index.update_user_profile("user-1", "post-a", 1.0)

    result = await index.recommend("user-1", 1, 1)

    assert result.post_ids == ["post-d"]
    assert result.total == 2


def _days_ago(days: int) -> str:
    return (datetime.now(UTC) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


async def test_recommend_surprise_returns_anti_taste_posts() -> None:
    index = MemoryIndex(_BagOfWordsEmbeddings())
    await _seed_fresh(index, "post-a", "kafka consumers")
    await _seed_fresh(index, "post-b", "kafka consumers guide")
    await _seed_fresh(index, "post-c", "italian pasta")
    await index.update_user_profile("user-1", "post-a", 1.0)

    default = await index.recommend("user-1", 0, 10)
    surprise = await index.recommend_surprise("user-1", 0, 1, seed=0)

    # The negated profile scores the pasta post ~0.0, only passable once
    # the strict threshold relaxes from 0.1 down to 0.0.
    assert default.post_ids == ["post-b"]
    assert surprise.post_ids == ["post-c"]
    assert surprise.total == 1


async def test_recommend_surprise_is_seed_stable() -> None:
    index = MemoryIndex(_BagOfWordsEmbeddings())
    await _seed_fresh(index, "post-a", "kafka consumers")
    await index.upsert("post-b", "italian pasta", "", "", [], _days_ago(1))
    await index.upsert("post-c", "kafka consumers guide", "", "", [], _days_ago(2))
    await index.upsert("post-d", "italian pasta", "", "", [], _days_ago(3))
    await index.update_user_profile("user-1", "post-a", 1.0)

    first = await index.recommend_surprise("user-1", 0, 10, seed=7)
    same_seed = await index.recommend_surprise("user-1", 0, 10, seed=7)
    other_seed = await index.recommend_surprise("user-1", 0, 10, seed=11)

    assert first.post_ids == same_seed.post_ids
    assert first.post_ids != other_seed.post_ids


async def test_recommend_surprise_falls_back_to_recent_posts() -> None:
    index = MemoryIndex(FakeEmbeddingClient())
    await _seed_fresh(index, "post-a", "beta doc")
    await index.upsert("post-b", "beta doc", "", "", [], _days_ago(1))
    await index.upsert("post-c", "beta doc", "", "", [], _days_ago(2))
    await index.update_user_profile("user-1", "post-a", 1.0)

    # Every candidate is exactly the user's taste: the negated query
    # scores them -1.0, below even the floor, so the feed falls back to
    # the newest posts.
    surprise = await index.recommend_surprise("user-1", 0, 2, seed=0)

    assert sorted(surprise.post_ids) == ["post-b", "post-c"]
    assert surprise.total == 2


async def test_recommend_surprise_excludes_seen_and_stale_posts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "RECOMMEND_RECENCY_DAYS", 60)
    index = MemoryIndex(FakeEmbeddingClient())
    await _seed_fresh(index, "post-a", "beta doc")
    await index.upsert("post-b", "beta doc", "", "", [], "2026-01-01T00:00:00Z")
    await index.upsert("post-c", "beta doc", "", "", [], "")
    await _seed_fresh(index, "post-d", "alpha doc")
    await index.update_user_profile("user-1", "post-a", 1.0)

    surprise = await index.recommend_surprise("user-1", 0, 1, seed=0)

    assert surprise.post_ids == ["post-d"]
    assert surprise.total == 1


async def test_recommend_surprise_returns_empty_for_cold_start_user(
    index: MemoryIndex,
) -> None:
    await _seed_fresh(index, "post-a", "kafka consumers")

    result = await index.recommend_surprise("user-1", 0, 10, seed=0)

    assert result == SearchResult(post_ids=[], total=0)
