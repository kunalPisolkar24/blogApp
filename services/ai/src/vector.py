"""Qdrant-backed hybrid search index.

Each post is stored as a point with two vectors: a dense embedding (semantic)
and a sparse term-frequency map (lexical). Queries run both channels and fuse
the results with reciprocal rank fusion, giving ES-like full-text behaviour
plus semantic recall.
"""

import hashlib
import logging
import math
import random
import struct
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from qdrant_client import AsyncQdrantClient, models

from src.config import settings
from src.domain.text import clean_html
from src.embeddings import EmbeddingProvider
from src.sparse import embed as sparse_embed

logger = logging.getLogger(__name__)

DENSE_VECTOR = "dense"
SPARSE_VECTOR = "sparse"


def _point_id(post_id: str) -> uuid.UUID:
    """Map a Mongo ObjectID hex string to a deterministic Qdrant point id.

    Qdrant only accepts unsigned integers or UUIDs as point ids. The
    ObjectID hex (24 chars) is padded to 32 chars, so the same post always
    maps to the same point and re-indexing overwrites instead of duplicating.
    """
    return uuid.UUID(hex=post_id.zfill(32))


def _post_id_from_point(point_id) -> str:
    """Reverse _point_id: map a Qdrant point id back to the post id hex."""
    hexed = (
        point_id.hex
        if isinstance(point_id, uuid.UUID)
        else str(point_id).replace("-", "")
    )
    if len(hexed) == 32 and hexed.startswith("00000000"):
        return hexed[8:]
    return str(uuid.UUID(hex=hexed))


def _user_point_id(user_id: str) -> uuid.UUID:
    """Map an arbitrary user id to a deterministic Qdrant point id.

    User ids come from the user service as PostgreSQL UUIDs (36 chars,
    dashed), which _point_id's ObjectID zfill trick does not accept. A
    namespaced UUID5 keeps any id format stable and collision-free.
    """
    return uuid.uuid5(uuid.NAMESPACE_URL, user_id)


def _token_id(token: str) -> int:
    """Stable 32-bit id for a sparse token (Qdrant requires uint32 indices)."""
    return struct.unpack("I", hashlib.blake2b(token.encode(), digest_size=4).digest())[
        0
    ]


def _sparse_vector(weights: dict[str, float]) -> models.SparseVector:
    items = sorted(weights.items())
    return models.SparseVector(
        indices=[_token_id(token) for token, _ in items],
        values=[weight for _, weight in items],
    )


@dataclass
class SearchResult:
    post_ids: list[str]
    total: int


@dataclass
class RetrievedPost:
    """A post retrieved as grounding context for the chat assistant."""

    post_id: str
    title: str
    body: str


def _embedding_text(title: str, body: str, summary: str) -> str:
    """Join the searchable parts of a post into a single embedding text."""
    body_text = clean_html(body)[: settings.EMBEDDING_MAX_CHARS]
    text = " ".join(part for part in (title, body_text, summary) if part)
    return text[: settings.EMBEDDING_MAX_CHARS]


class SearchIndex:
    def __init__(
        self, embeddings: EmbeddingProvider, client: AsyncQdrantClient | None = None
    ) -> None:
        self._embeddings = embeddings
        self._client = client or AsyncQdrantClient(
            url=settings.QDRANT_URL,
            api_key=settings.QDRANT_API_KEY,
            timeout=settings.QDRANT_TIMEOUT_SECONDS,
        )

    async def ensure_collection(self) -> None:
        """Create the collections backing search and recommendations.

        Both the posts and users collections share the same vector config:
        a dense COSINE channel sized to the embedding model plus a sparse
        IDF channel. Existing collections are left untouched, so a
        pre-existing posts collection keeps its data and configuration.
        """
        for name in (settings.QDRANT_COLLECTION, settings.QDRANT_USERS_COLLECTION):
            await self._ensure_collection(name)

    async def _ensure_collection(self, name: str) -> None:
        if await self._client.collection_exists(name):
            return
        await self._client.create_collection(
            collection_name=name,
            vectors_config={
                DENSE_VECTOR: models.VectorParams(
                    size=settings.QDRANT_VECTOR_SIZE,
                    distance=models.Distance.COSINE,
                )
            },
            sparse_vectors_config={
                SPARSE_VECTOR: models.SparseVectorParams(modifier=models.Modifier.IDF)
            },
        )
        if name == settings.QDRANT_COLLECTION:
            # The surprise feed's recent-posts fallback orders by
            # created_at; qdrant only allows order_by on an indexed field.
            await self._client.create_payload_index(
                collection_name=name,
                field_name="created_at",
                field_schema=models.PayloadSchemaType.DATETIME,
            )
        logger.info("created qdrant collection %s", name)

    async def upsert(
        self,
        post_id: str,
        title: str,
        body: str,
        summary: str,
        tags: list[str],
        created_at: str,
    ) -> None:
        text = _embedding_text(title, body, summary)
        dense = (await self._embeddings.embed([text]))[0]
        # The cleaned body is stored as payload so the chat assistant can
        # ground its answers in the retrieved excerpts without a round
        # trip to any other service.
        await self._client.upsert(
            collection_name=settings.QDRANT_COLLECTION,
            points=[
                models.PointStruct(
                    id=_point_id(post_id),
                    vector={
                        DENSE_VECTOR: dense,
                        SPARSE_VECTOR: _sparse_vector(sparse_embed(text)),
                    },
                    payload={
                        "title": title,
                        "body": clean_html(body)[: settings.EMBEDDING_MAX_CHARS],
                        "summary": summary,
                        "tags": tags,
                        "created_at": created_at,
                    },
                )
            ],
        )

    async def delete(self, post_id: str) -> None:
        await self._client.delete(
            collection_name=settings.QDRANT_COLLECTION,
            points_selector=[_point_id(post_id)],
        )

    async def related(self, post_id: str, limit: int) -> list[str]:
        """Return the post_ids of the nearest neighbours of a stored post.

        Queries Qdrant with the post's own dense vector (no re-embedding)
        and excludes the post itself. An unindexed post yields an empty
        result rather than an error, so new posts degrade gracefully while
        the index worker catches up.
        """
        point_id = _point_id(post_id)
        if not await self._client.retrieve(
            collection_name=settings.QDRANT_COLLECTION,
            ids=[point_id],
        ):
            return []
        response = await self._client.query_points(
            collection_name=settings.QDRANT_COLLECTION,
            query=point_id,
            using=DENSE_VECTOR,
            limit=limit,
            score_threshold=settings.SEARCH_DENSE_SCORE_THRESHOLD,
            query_filter=models.Filter(
                must_not=[models.HasIdCondition(has_id=[point_id])]
            ),
        )
        return [_post_id_from_point(point.id) for point in response.points]

    async def count(self) -> int:
        """Number of indexed posts: the pool related results draw from."""
        response = await self._client.count(
            collection_name=settings.QDRANT_COLLECTION,
        )
        return response.count

    async def search(self, query: str, offset: int, limit: int) -> SearchResult:
        dense = (await self._embeddings.embed([query]))[0]
        # Same threshold as retrieve_by_vector so unrelated queries cannot
        # surface weak-similarity posts through the hybrid channel.
        post_ids = await self._rank_window(
            dense,
            sparse_embed(query),
            None,
            dense_score_threshold=settings.SEARCH_DENSE_SCORE_THRESHOLD,
        )
        return SearchResult(
            post_ids=post_ids[offset : offset + limit], total=len(post_ids)
        )

    async def _rank_window(
        self,
        dense: list[float],
        sparse_weights: dict[str, float],
        query_filter: models.Filter | None,
        dense_score_threshold: float | None = None,
    ) -> list[str]:
        """Rank the whole searchable window for a dense query vector.

        Runs the dense and sparse channels as parallel prefetches fused
        with reciprocal rank fusion, or dense alone when the query has no
        sparse terms, and returns the stable full-window ranking. Qdrant
        1.19 does not expose a total count for query points, so fetching
        the whole window once is the only way to report an exact total
        while keeping every page of the same query on a single ranking.
        """
        window = settings.SEARCH_MAX_RESULT_WINDOW
        threshold = (
            settings.SEARCH_DENSE_SCORE_THRESHOLD
            if dense_score_threshold is None
            else dense_score_threshold
        )
        if sparse_weights:
            response = await self._client.query_points(
                collection_name=settings.QDRANT_COLLECTION,
                prefetch=[
                    models.Prefetch(
                        query=dense,
                        using=DENSE_VECTOR,
                        limit=window,
                        score_threshold=threshold,
                        filter=query_filter,
                    ),
                    models.Prefetch(
                        query=_sparse_vector(sparse_weights),
                        using=SPARSE_VECTOR,
                        limit=window,
                        filter=query_filter,
                    ),
                ],
                query=models.FusionQuery(fusion=models.Fusion.RRF),
                limit=window,
            )
        else:
            response = await self._client.query_points(
                collection_name=settings.QDRANT_COLLECTION,
                query=dense,
                using=DENSE_VECTOR,
                score_threshold=threshold,
                query_filter=query_filter,
                limit=window,
            )
        return [_post_id_from_point(point.id) for point in response.points]

    async def retrieve_by_vector(
        self, vector: list[float], top_k: int
    ) -> list[RetrievedPost]:
        """Return the top-k posts closest to a query vector, as grounding
        context for the chat assistant.

        Only the dense channel is used: the query was already embedded by
        the caller (via the same path exposed by the Embed RPC), and the
        score threshold keeps irrelevant points out of the context.
        """
        response = await self._client.query_points(
            collection_name=settings.QDRANT_COLLECTION,
            query=vector,
            using=DENSE_VECTOR,
            limit=top_k,
            score_threshold=settings.SEARCH_DENSE_SCORE_THRESHOLD,
        )

        posts: list[RetrievedPost] = []
        for point in response.points:
            payload = point.payload or {}
            posts.append(
                RetrievedPost(
                    post_id=_post_id_from_point(point.id),
                    title=payload.get("title", ""),
                    body=payload.get("body", ""),
                )
            )
        return posts

    async def get_posts(self, post_ids: list[str]) -> list[RetrievedPost]:
        """Fetch stored posts by id, in the order requested.

        Unknown ids are skipped; used to hydrate ranked id lists (hybrid
        search, recommendations) into full grounding context.
        """
        if not post_ids:
            return []
        records = await self._client.retrieve(
            collection_name=settings.QDRANT_COLLECTION,
            ids=[_point_id(post_id) for post_id in post_ids],
            with_payload=True,
        )
        payload_by_id = {
            _post_id_from_point(record.id): record.payload or {} for record in records
        }
        return [
            RetrievedPost(
                post_id=post_id,
                title=payload_by_id[post_id].get("title", ""),
                body=payload_by_id[post_id].get("body", ""),
            )
            for post_id in post_ids
            if post_id in payload_by_id
        ]

    async def user_tag_weights(self, user_id: str) -> dict[str, float]:
        """The user's accumulated interest-tag weights; empty on cold start."""
        profile = await self._user_profile(user_id)
        if profile is None:
            return {}
        return profile[1].get("tag_weights") or {}

    async def post_tags(self, post_ids: list[str]) -> dict[str, list[str]]:
        """Map each known post id to its stored tags."""
        if not post_ids:
            return {}
        records = await self._client.retrieve(
            collection_name=settings.QDRANT_COLLECTION,
            ids=[_point_id(post_id) for post_id in post_ids],
            with_payload=True,
        )
        return {
            _post_id_from_point(record.id): (record.payload or {}).get("tags", [])
            for record in records
        }

    async def update_user_profile(
        self, user_id: str, post_id: str, weight: float
    ) -> None:
        """Fold one interaction into a user's interest profile.

        Reads the interacted post's stored dense vector and tags — no
        embedding call — and blends them into the user's point in the
        users collection. An unindexed post is a no-op, so interactions
        racing the index worker are dropped rather than failed.
        """
        posts = await self._client.retrieve(
            collection_name=settings.QDRANT_COLLECTION,
            ids=[_point_id(post_id)],
            with_vectors=True,
        )
        if not posts:
            logger.debug("profile update skipped: post %s not indexed", post_id)
            return
        post = posts[0]
        post_dense = post.vector[DENSE_VECTOR]
        post_tags = (post.payload or {}).get("tags", [])

        profiles = await self._client.retrieve(
            collection_name=settings.QDRANT_USERS_COLLECTION,
            ids=[_user_point_id(user_id)],
            with_vectors=True,
        )
        previous = None
        if profiles:
            payload = profiles[0].payload or {}
            previous = _ProfileState(
                total_weight=payload.get("total_weight", 0.0),
                dense=profiles[0].vector[DENSE_VECTOR],
                tag_weights=payload.get("tag_weights", {}),
                seen_post_ids=payload.get("seen_post_ids", []),
                updated_at=payload.get("updated_at", ""),
            )

        profile = _fold_profile(previous, post_id, post_dense, post_tags, weight)
        await self._client.upsert(
            collection_name=settings.QDRANT_USERS_COLLECTION,
            points=[
                models.PointStruct(
                    id=_user_point_id(user_id),
                    vector={
                        DENSE_VECTOR: profile.dense,
                        SPARSE_VECTOR: _sparse_vector(profile.tag_weights),
                    },
                    payload={
                        "total_weight": profile.total_weight,
                        "tag_weights": profile.tag_weights,
                        "seen_post_ids": profile.seen_post_ids,
                        "updated_at": profile.updated_at,
                    },
                )
            ],
        )

    async def recommend(
        self,
        user_id: str,
        offset: int,
        limit: int,
        recency_days: int | None = None,
    ) -> SearchResult:
        """Rank posts for a user from their stored interest profile.

        Queries the posts collection with the user's profile vector and
        tag weights — no embedding call — restricted to posts created
        within `recency_days` (RECOMMEND_RECENCY_DAYS when omitted) and
        excluding the user's seen history. A user without a profile
        (cold start) gets an empty feed so the content service can fall
        back to recency-based ranking.
        """
        profile = await self._user_profile(user_id)
        if profile is None:
            return SearchResult(post_ids=[], total=0)

        post_ids = await self._rank_window(
            profile[0],
            profile[1].get("tag_weights", {}),
            self._feed_filter(profile[1], recency_days),
        )
        return SearchResult(
            post_ids=post_ids[offset : offset + limit], total=len(post_ids)
        )

    async def _user_profile(self, user_id: str) -> tuple[list[float], dict] | None:
        """The user's stored dense vector and payload, or None on cold start.

        A missing point or a profile with no accumulated weight carries
        no taste signal, so both count as cold start.
        """
        profiles = await self._client.retrieve(
            collection_name=settings.QDRANT_USERS_COLLECTION,
            ids=[_user_point_id(user_id)],
            with_vectors=True,
        )
        if not profiles:
            return None
        payload = profiles[0].payload or {}
        if payload.get("total_weight", 0.0) <= 0:
            return None
        return profiles[0].vector[DENSE_VECTOR], payload

    def _feed_filter(
        self, payload: dict, recency_days: int | None = None
    ) -> models.Filter:
        """Restrict the feed to recent posts the user has not seen yet."""
        days = (
            recency_days
            if recency_days is not None
            else settings.RECOMMEND_RECENCY_DAYS
        )
        cutoff = datetime.now(UTC) - timedelta(days=days)
        must = [
            models.FieldCondition(
                key="created_at",
                range=models.DatetimeRange(gte=cutoff),
            )
        ]
        must_not = []
        seen = payload.get("seen_post_ids", [])
        if seen:
            must_not.append(
                models.HasIdCondition(has_id=[_point_id(post_id) for post_id in seen])
            )
        return models.Filter(must=must, must_not=must_not)

    async def recommend_surprise(
        self, user_id: str, offset: int, limit: int, seed: int
    ) -> SearchResult:
        """Rank posts deliberately unlike the user's usual taste.

        Queries the negated profile vector (anti-taste dense channel)
        fused with the user's least-used tags (weak-taste sparse channel),
        starting at a strict threshold and relaxing step by step until the
        page fills. A window that never fills falls back to the newest
        posts. The final window is shuffled deterministically by `seed`
        before slicing, so a seed yields a stable but varied ordering.
        """
        profile = await self._user_profile(user_id)
        if profile is None:
            return SearchResult(post_ids=[], total=0)
        dense, payload = profile

        query_filter = self._feed_filter(payload)
        sparse = _least_used_tags(
            payload.get("tag_weights") or {}, settings.SURPRISE_TAG_TOP_K
        )
        need = offset + limit
        threshold = settings.SURPRISE_DENSE_SCORE_THRESHOLD
        post_ids: list[str] = []
        while threshold >= settings.SURPRISE_THRESHOLD_FLOOR and len(post_ids) < need:
            post_ids = await self._rank_window(
                [-component for component in dense], sparse, query_filter, threshold
            )
            threshold -= settings.SURPRISE_THRESHOLD_STEP
        if len(post_ids) < need:
            post_ids = await self._recent_posts(query_filter)

        post_ids = _seeded_shuffle(post_ids, seed)
        return SearchResult(
            post_ids=post_ids[offset : offset + limit], total=len(post_ids)
        )

    async def _recent_posts(self, query_filter: models.Filter) -> list[str]:
        """The newest posts matching a filter, in descending age order."""
        response = await self._client.query_points(
            collection_name=settings.QDRANT_COLLECTION,
            query=models.OrderByQuery(
                order_by=models.OrderBy(
                    key="created_at", direction=models.Direction.DESC
                )
            ),
            query_filter=query_filter,
            limit=settings.SEARCH_MAX_RESULT_WINDOW,
        )
        return [_post_id_from_point(point.id) for point in response.points]

    async def close(self) -> None:
        await self._client.close()


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    """Cosine similarity, robust to non-normalised embedding providers."""
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


def _sparse_overlap(query: dict[str, float], stored: dict[str, float]) -> float:
    """Lexical similarity: the dot product of the two term-frequency maps."""
    return sum(
        weight * stored[token] for token, weight in query.items() if token in stored
    )


def _renormalize(vector: list[float]) -> list[float]:
    """Scale a vector to unit length; a zero vector stays as-is."""
    norm = math.sqrt(sum(component**2 for component in vector))
    if norm == 0:
        return vector
    return [component / norm for component in vector]


def _least_used_tags(tag_weights: dict[str, float], top_k: int) -> dict[str, float]:
    """The user's least-used tags: the weakest expression of their taste.

    Tags are ranked by accumulated weight ascending, so the bottom-k carry
    the least signal and make good surprise-mode sparse query terms.
    """
    return dict(sorted(tag_weights.items(), key=lambda item: item[1])[:top_k])


def _seeded_shuffle(items: list[str], seed: int) -> list[str]:
    """Deterministic shuffle: the same seed always yields the same order."""
    shuffled = list(items)
    random.Random(seed).shuffle(shuffled)
    return shuffled


@dataclass
class _ProfileState:
    """The accumulated interest profile of a single user.

    total_weight is the denominator of the running dense average,
    tag_weights the sparse interest map, and seen_post_ids the
    deduplicated interaction history recommends can exclude.
    """

    total_weight: float
    dense: list[float]
    tag_weights: dict[str, float]
    seen_post_ids: list[str]
    updated_at: str


def _fold_profile(
    profile: _ProfileState | None,
    post_id: str,
    post_dense: list[float],
    post_tags: list[str],
    weight: float,
) -> _ProfileState:
    """Fold one interaction into a user's interest profile.

    The dense vector is a weighted running average: each interaction moves
    the profile towards the interacted post by `weight`, renormalised to
    unit length so cosine similarity stays comparable. Tags accumulate the
    same weight, capped per tag and in total; when the tag map is full a
    fresh tag replaces the weakest one. seen_post_ids keeps the latest
    interactions, deduplicated and capped by PROFILE_SEEN_POSTS_CAP.
    """
    total = profile.total_weight if profile else 0.0
    prev_dense = profile.dense if profile else [0.0] * len(post_dense)
    dense = _renormalize(
        [
            (prev * total + post * weight) / (total + weight)
            for prev, post in zip(prev_dense, post_dense)
        ]
    )

    tag_weights = dict(profile.tag_weights) if profile else {}
    for tag in post_tags:
        if not tag:
            continue
        if tag not in tag_weights and len(tag_weights) >= settings.PROFILE_MAX_TAGS:
            tag_weights.pop(min(tag_weights, key=tag_weights.get))
        tag_weights[tag] = min(
            tag_weights.get(tag, 0.0) + weight, settings.PROFILE_TAG_WEIGHT_CAP
        )

    seen = [
        entry
        for entry in (profile.seen_post_ids if profile else [])
        if entry != post_id
    ]
    seen = (seen + [post_id])[-settings.PROFILE_SEEN_POSTS_CAP :]

    return _ProfileState(
        total_weight=total + weight,
        dense=dense,
        tag_weights=tag_weights,
        seen_post_ids=seen,
        updated_at=datetime.now(UTC).isoformat(),
    )


def _rrf_fuse(rankings: list[list[str]], k: int = 60) -> list[str]:
    """Reciprocal rank fusion over ranked post id lists, stable per post."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, post_id in enumerate(ranking, start=1):
            scores[post_id] = scores.get(post_id, 0.0) + 1.0 / (k + rank)
    return sorted(scores, key=lambda post_id: scores[post_id], reverse=True)


@dataclass
class _StoredPost:
    """The per-post state MemoryIndex keeps instead of Qdrant points."""

    post_id: str
    dense: list[float]
    tokens: dict[str, float]
    title: str
    body: str
    tags: list[str]
    created_at: str


def _parse_created_at(created_at: str) -> datetime | None:
    """Parse a stored RFC3339 created_at, or None when it is unusable."""
    if not created_at:
        return None
    try:
        return datetime.fromisoformat(created_at)
    except ValueError:
        return None


def _created_after(created_at: str, cutoff: datetime) -> bool:
    """True when a post's created_at falls at or after the cutoff.

    Posts without a usable created_at are excluded, matching the qdrant
    recency filter which likewise requires the field.
    """
    parsed = _parse_created_at(created_at)
    return parsed is not None and parsed >= cutoff


class MemoryIndex:
    """Deterministic in-memory twin of SearchIndex, no Qdrant required.

    Scores posts locally with the same recipe Qdrant uses: dense cosine
    similarity gated by SEARCH_DENSE_SCORE_THRESHOLD, fused with sparse
    token overlap via RRF. Exact text matches score ~1.0 and unrelated
    text ~0.0 under fake embeddings, so load tests can exercise the full
    search/related RPC path without a containerised store.

    Semantics are approximate, not bit-for-bit: ties are broken by
    insertion order, and sparse weights are the raw token frequencies
    rather than Qdrant's IDF-modified vectors.
    """

    def __init__(self, embeddings: EmbeddingProvider) -> None:
        self._embeddings = embeddings
        self._posts: dict[str, _StoredPost] = {}
        self._profiles: dict[str, _ProfileState] = {}

    async def ensure_collection(self) -> None:
        return None

    async def upsert(
        self,
        post_id: str,
        title: str,
        body: str,
        summary: str,
        tags: list[str],
        created_at: str,
    ) -> None:
        text = _embedding_text(title, body, summary)
        dense = (await self._embeddings.embed([text]))[0]
        self._posts[post_id] = _StoredPost(
            post_id=post_id,
            dense=dense,
            tokens=sparse_embed(text),
            title=title,
            body=clean_html(body)[: settings.EMBEDDING_MAX_CHARS],
            tags=list(tags),
            created_at=created_at,
        )

    async def delete(self, post_id: str) -> None:
        self._posts.pop(post_id, None)

    async def related(self, post_id: str, limit: int) -> list[str]:
        """Nearest neighbours of a stored post, excluding itself.

        Mirrors SearchIndex.related: the post's own dense vector is
        queried (no re-embedding) and an unknown post yields an empty
        result.
        """
        post = self._posts.get(post_id)
        if post is None:
            return []

        scored = [
            (candidate.post_id, _cosine_similarity(post.dense, candidate.dense))
            for candidate in self._posts.values()
            if candidate.post_id != post_id
        ]
        scored.sort(key=lambda item: item[1], reverse=True)
        above_threshold = [
            candidate_id
            for candidate_id, score in scored
            if score >= settings.SEARCH_DENSE_SCORE_THRESHOLD
        ]
        return above_threshold[:limit]

    async def count(self) -> int:
        """Number of stored posts: the pool related results draw from."""
        return len(self._posts)

    async def search(self, query: str, offset: int, limit: int) -> SearchResult:
        dense = (await self._embeddings.embed([query]))[0]
        sparse = sparse_embed(query)

        dense_scored = [
            (post.post_id, _cosine_similarity(dense, post.dense))
            for post in self._posts.values()
        ]
        dense_scored.sort(key=lambda item: item[1], reverse=True)
        dense_ranking = [
            post_id
            for post_id, score in dense_scored
            if score >= settings.SEARCH_DENSE_SCORE_THRESHOLD
        ]

        window = settings.SEARCH_MAX_RESULT_WINDOW
        rankings = [dense_ranking[:window]]
        if sparse:
            # Only posts sharing at least one token can be sparse hits;
            # Qdrant's sparse search likewise returns no zero-score points.
            scored = [
                (post.post_id, _sparse_overlap(sparse, post.tokens))
                for post in self._posts.values()
            ]
            scored.sort(key=lambda item: item[1], reverse=True)
            sparse_ranking = [post_id for post_id, score in scored if score > 0]
            rankings.append(sparse_ranking[:window])

        fused = _rrf_fuse(rankings)[:window]
        return SearchResult(post_ids=fused[offset : offset + limit], total=len(fused))

    async def retrieve_by_vector(
        self, vector: list[float], top_k: int
    ) -> list[RetrievedPost]:
        """Mirror SearchIndex.retrieve_by_vector over in-memory posts."""
        scored = [
            (post, _cosine_similarity(vector, post.dense))
            for post in self._posts.values()
        ]
        scored.sort(key=lambda item: item[1], reverse=True)
        return [
            RetrievedPost(post_id=post.post_id, title=post.title, body=post.body)
            for post, score in scored[:top_k]
            if score >= settings.SEARCH_DENSE_SCORE_THRESHOLD
        ]

    async def get_posts(self, post_ids: list[str]) -> list[RetrievedPost]:
        """Mirror SearchIndex.get_posts over in-memory posts."""
        posts = []
        for post_id in post_ids:
            stored = self._posts.get(post_id)
            if stored is not None:
                posts.append(
                    RetrievedPost(post_id=post_id, title=stored.title, body=stored.body)
                )
        return posts

    async def user_tag_weights(self, user_id: str) -> dict[str, float]:
        """Mirror SearchIndex.user_tag_weights over in-memory profiles."""
        profile = self._profiles.get(user_id)
        if profile is None or profile.total_weight <= 0:
            return {}
        return dict(profile.tag_weights)

    async def post_tags(self, post_ids: list[str]) -> dict[str, list[str]]:
        """Mirror SearchIndex.post_tags over in-memory posts."""
        return {
            post_id: self._posts[post_id].tags
            for post_id in post_ids
            if post_id in self._posts
        }

    async def update_user_profile(
        self, user_id: str, post_id: str, weight: float
    ) -> None:
        """Mirror SearchIndex.update_user_profile over in-memory posts."""
        post = self._posts.get(post_id)
        if post is None:
            return
        self._profiles[user_id] = _fold_profile(
            self._profiles.get(user_id), post.post_id, post.dense, post.tags, weight
        )

    async def recommend(
        self,
        user_id: str,
        offset: int,
        limit: int,
        recency_days: int | None = None,
    ) -> SearchResult:
        """Mirror SearchIndex.recommend over in-memory posts."""
        profile = self._profiles.get(user_id)
        if profile is None or profile.total_weight <= 0:
            return SearchResult(post_ids=[], total=0)

        days = (
            recency_days
            if recency_days is not None
            else settings.RECOMMEND_RECENCY_DAYS
        )
        cutoff = datetime.now(UTC) - timedelta(days=days)
        seen = set(profile.seen_post_ids)
        candidates = [
            post
            for post in self._posts.values()
            if post.post_id not in seen and _created_after(post.created_at, cutoff)
        ]

        window = settings.SEARCH_MAX_RESULT_WINDOW
        dense_scored = [
            (post.post_id, _cosine_similarity(profile.dense, post.dense))
            for post in candidates
        ]
        dense_scored.sort(key=lambda item: item[1], reverse=True)
        dense_ranking = [
            post_id
            for post_id, score in dense_scored
            if score >= settings.SEARCH_DENSE_SCORE_THRESHOLD
        ]

        rankings = [dense_ranking[:window]]
        if profile.tag_weights:
            scored = [
                (post.post_id, _sparse_overlap(profile.tag_weights, post.tokens))
                for post in candidates
            ]
            scored.sort(key=lambda item: item[1], reverse=True)
            sparse_ranking = [post_id for post_id, score in scored if score > 0]
            rankings.append(sparse_ranking[:window])

        fused = _rrf_fuse(rankings)[:window]
        return SearchResult(post_ids=fused[offset : offset + limit], total=len(fused))

    async def recommend_surprise(
        self, user_id: str, offset: int, limit: int, seed: int
    ) -> SearchResult:
        """Mirror SearchIndex.recommend_surprise over in-memory posts."""
        profile = self._profiles.get(user_id)
        if profile is None or profile.total_weight <= 0:
            return SearchResult(post_ids=[], total=0)

        cutoff = datetime.now(UTC) - timedelta(days=settings.RECOMMEND_RECENCY_DAYS)
        seen = set(profile.seen_post_ids)
        candidates = [
            post
            for post in self._posts.values()
            if post.post_id not in seen and _created_after(post.created_at, cutoff)
        ]
        window = settings.SEARCH_MAX_RESULT_WINDOW
        need = offset + limit
        sparse = _least_used_tags(profile.tag_weights, settings.SURPRISE_TAG_TOP_K)

        threshold = settings.SURPRISE_DENSE_SCORE_THRESHOLD
        post_ids: list[str] = []
        while threshold >= settings.SURPRISE_THRESHOLD_FLOOR and len(post_ids) < need:
            dense_scored = [
                (
                    post.post_id,
                    _cosine_similarity(
                        [-component for component in profile.dense], post.dense
                    ),
                )
                for post in candidates
            ]
            dense_scored.sort(key=lambda item: item[1], reverse=True)
            dense_ranking = [
                post_id for post_id, score in dense_scored if score >= threshold
            ]

            rankings = [dense_ranking[:window]]
            if sparse:
                scored = [
                    (post.post_id, _sparse_overlap(sparse, post.tokens))
                    for post in candidates
                ]
                scored.sort(key=lambda item: item[1], reverse=True)
                sparse_ranking = [post_id for post_id, score in scored if score > 0]
                rankings.append(sparse_ranking[:window])

            post_ids = _rrf_fuse(rankings)[:window]
            threshold -= settings.SURPRISE_THRESHOLD_STEP

        if len(post_ids) < need:
            post_ids = [
                post.post_id
                for post in sorted(
                    candidates,
                    key=lambda post: _parse_created_at(post.created_at),
                    reverse=True,
                )
            ][:window]

        post_ids = _seeded_shuffle(post_ids, seed)
        return SearchResult(
            post_ids=post_ids[offset : offset + limit], total=len(post_ids)
        )

    async def close(self) -> None:
        return None


# The concrete store variants AIService accepts.
SearchStore = SearchIndex | MemoryIndex
