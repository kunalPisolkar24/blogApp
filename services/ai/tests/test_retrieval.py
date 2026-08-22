import asyncio
import logging

import pytest

from src.graphs.retrieval import (
    DenseSource,
    HybridSource,
    fan_out,
    fuse_context,
)
from src.vector import RetrievedPost, SearchResult


def _post(post_id: str, body: str = "b") -> RetrievedPost:
    return RetrievedPost(post_id=post_id, title=f"t {post_id}", body=body)


class FakeSource:
    """Retrieval source stub returning a fixed ranking."""

    def __init__(self, name: str, weight: float, ranking: list[RetrievedPost]) -> None:
        self.name = name
        self.weight = weight
        self.ranking = list(ranking)

    async def fetch(self, query: str, top_k: int) -> list[RetrievedPost]:
        return self.ranking[:top_k]


def test_fusion_weights_consensus_above_single_hits() -> None:
    heavy = FakeSource("heavy", 2.0, [_post("a"), _post("b")])
    light = FakeSource("light", 1.0, [_post("b"), _post("c")])

    fused = fuse_context([(heavy.weight, heavy.ranking), (light.weight, light.ranking)])

    # b is the only post both sources returned, so its weighted consensus
    # outranks a (heavy's top pick alone) and c (light-only).
    assert [post.post_id for post in fused] == ["b", "a", "c"]


def test_fusion_dedupes_posts_across_sources() -> None:
    rankings = [
        (1.0, [_post("a"), _post("b")]),
        (1.0, [_post("b")]),
    ]

    fused = fuse_context(rankings)

    # b is returned by both sources, so consensus ranks it first.
    assert [post.post_id for post in fused] == ["b", "a"]
    assert all(post.body == "b" for post in fused)


def test_fusion_fills_budget_greedily_and_truncates_boundary() -> None:
    long_a = RetrievedPost(post_id="a", title="t a", body="x" * 100)
    long_b = RetrievedPost(post_id="b", title="t b", body="y" * 100)
    long_c = RetrievedPost(post_id="c", title="t c", body="z" * 100)

    fused = fuse_context([(1.0, [long_a, long_b, long_c])], budget_chars=150)

    assert [post.post_id for post in fused] == ["a", "b"]
    assert fused[0].body == "x" * 100
    assert fused[1].body == "y" * 50


def test_fusion_with_zero_budget_returns_nothing() -> None:
    fused = fuse_context([(1.0, [_post("a")])], budget_chars=0)

    assert fused == []


async def test_fan_out_degrades_when_a_source_fails(caplog) -> None:
    class BrokenSource(FakeSource):
        async def fetch(self, query: str, top_k: int) -> list[RetrievedPost]:
            raise RuntimeError("qdrant exploded")

    sources = [
        FakeSource("ok-1", 1.0, [_post("a")]),
        BrokenSource("broken", 1.0, []),
        FakeSource("ok-2", 1.0, [_post("c")]),
    ]

    with caplog.at_level(logging.WARNING, logger="src.graphs.retrieval"):
        fetched = await fan_out(sources, "query", 3)

    names = sorted(source.name for source, _ in fetched)
    assert names == ["ok-1", "ok-2"]
    assert any("retrieval source failed" in r.message for r in caplog.records)


async def test_fan_out_bounds_concurrency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("src.config.settings.CHAT_RETRIEVAL_CONCURRENCY", 2)
    active = [0]
    peak = [0]

    def slow_source(name: str):
        class Slow(FakeSource):
            async def fetch(self, query: str, top_k: int) -> list[RetrievedPost]:
                active[0] += 1
                peak[0] = max(peak[0], active[0])
                await asyncio.sleep(0.02)
                active[0] -= 1
                return []

        return Slow(name, 1.0, [])

    sources = [slow_source(f"source-{i}") for i in range(5)]
    fetched = await fan_out(sources, "query", 3)

    assert len(fetched) == 5
    assert peak[0] <= 2


class StubStore:
    """Store stub exposing only what the hybrid and dense sources need."""

    def __init__(
        self,
        hybrid_ids: list[str] | None = None,
        dense_posts: list[RetrievedPost] | None = None,
    ) -> None:
        self.hybrid_ids = list(hybrid_ids or [])
        self.dense_posts = list(dense_posts or [])
        self.embed_queries: list[str] = []
        self.searched: list[tuple[str, int]] = []

    async def search(self, query: str, offset: int, limit: int) -> SearchResult:
        self.searched.append((query, limit))
        return SearchResult(post_ids=self.hybrid_ids, total=len(self.hybrid_ids))

    async def get_posts(self, post_ids: list[str]) -> list[RetrievedPost]:
        by_id = {post.post_id: post for post in self.dense_posts}
        return [by_id[post_id] for post_id in post_ids if post_id in by_id]

    async def retrieve_by_vector(
        self, vector: list[float], top_k: int
    ) -> list[RetrievedPost]:
        return self.dense_posts


class StubEmbeddings:
    def __init__(self) -> None:
        self.embed_queries: list[str] = []

    async def embed(self, texts: list[str]) -> list[list[float]]:
        self.embed_queries.extend(texts)
        return [[float(len(text))] * 4 for text in texts]


async def test_hybrid_source_hydrates_ranked_ids() -> None:
    store = StubStore(
        hybrid_ids=["c", "a"],
        dense_posts=[_post("a"), _post("c")],
    )

    posts = await HybridSource(store).fetch("query", 2)

    assert [post.post_id for post in posts] == ["c", "a"]
    assert store.searched == [("query", 2)]


async def test_dense_source_embeds_then_retrieves() -> None:
    store = StubStore(dense_posts=[_post("a")])
    embeddings = StubEmbeddings()

    posts = await DenseSource(store, embeddings).fetch("embedded query", 5)

    assert embeddings.embed_queries == ["embedded query"]
    assert [post.post_id for post in posts] == ["a"]
