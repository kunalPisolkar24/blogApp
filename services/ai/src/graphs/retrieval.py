"""Multi-source grounding retrieval for the chat graph.

Several ranked sources answer one query in parallel under a bounded
semaphore; their rankings fuse through weighted reciprocal rank fusion
into a single deduped context that fits the shared character budget.
"""

import asyncio
import logging
from collections.abc import Sequence
from typing import Protocol

from src.config import settings
from src.embeddings import EmbeddingProvider
from src.vector import RetrievedPost, SearchStore

logger = logging.getLogger(__name__)

# Reciprocal-rank-fusion depth; matches the constant the stores use.
_RRF_K = 60


class RetrievalSource(Protocol):
    """One named, weighted fetcher of ranked grounding posts."""

    name: str
    weight: float

    async def fetch(self, query: str, top_k: int) -> list[RetrievedPost]: ...


class DenseSource:
    """Dense-vector nearest posts for the embedded query."""

    name = "dense"

    def __init__(
        self,
        search: SearchStore,
        embeddings: EmbeddingProvider,
        weight: float | None = None,
    ) -> None:
        self._search = search
        self._embeddings = embeddings
        self.weight = settings.CHAT_DENSE_SOURCE_WEIGHT if weight is None else weight

    async def fetch(self, query: str, top_k: int) -> list[RetrievedPost]:
        vector = (await self._embeddings.embed([query]))[0]
        return await self._search.retrieve_by_vector(vector, top_k)


class HybridSource:
    """Hybrid dense+sparse search results, hydrated into full posts."""

    name = "hybrid"

    def __init__(self, search: SearchStore, weight: float | None = None) -> None:
        self._search = search
        self.weight = settings.CHAT_HYBRID_SOURCE_WEIGHT if weight is None else weight

    async def fetch(self, query: str, top_k: int) -> list[RetrievedPost]:
        result = await self._search.search(query, 0, top_k)
        return await self._search.get_posts(result.post_ids)


async def fan_out(
    sources: Sequence[RetrievalSource], query: str, top_k: int
) -> list[tuple[RetrievalSource, list[RetrievedPost]]]:
    """Fetch every source concurrently under a shared semaphore.

    A failing source is logged and skipped so one flaky backend degrades
    the turn to the remaining sources instead of failing it.
    """
    semaphore = asyncio.Semaphore(settings.CHAT_RETRIEVAL_CONCURRENCY)

    async def guarded(source: RetrievalSource):
        async with semaphore:
            return source, await source.fetch(query, top_k)

    outcomes = await asyncio.gather(
        *(guarded(source) for source in sources), return_exceptions=True
    )
    fetched: list[tuple[RetrievalSource, list[RetrievedPost]]] = []
    for outcome in outcomes:
        if isinstance(outcome, BaseException):
            logger.warning("retrieval source failed: %s", outcome)
            continue
        fetched.append(outcome)
    return fetched


def fuse_context(
    rankings: Sequence[tuple[float, list[RetrievedPost]]],
    budget_chars: int | None = None,
) -> list[RetrievedPost]:
    """Fuse per-source rankings into one deduped, budget-capped context.

    A post scores ``weight / (_RRF_K + rank)`` summed across every source
    that returned it, so consensus between sources outranks a single hit
    and heavier sources rank their own hits higher. The character budget
    fills greedily by score; the post crossing it is truncated and the
    rest are dropped.
    """
    budget = settings.CHAT_MAX_CONTEXT_CHARS if budget_chars is None else budget_chars
    scores: dict[str, float] = {}
    posts: dict[str, RetrievedPost] = {}
    for weight, ranked in rankings:
        for index, post in enumerate(ranked):
            scores[post.post_id] = scores.get(post.post_id, 0.0) + weight / (
                _RRF_K + index
            )
            posts.setdefault(post.post_id, post)

    selected: list[RetrievedPost] = []
    remaining = budget
    for post_id in sorted(scores, key=scores.get, reverse=True):
        if remaining <= 0:
            break
        post = posts[post_id]
        body = post.body[:remaining]
        remaining -= len(body)
        selected.append(
            RetrievedPost(post_id=post.post_id, title=post.title, body=body)
        )
    return selected
