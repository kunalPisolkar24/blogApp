"""Qdrant-backed hybrid search index.

Each post is stored as a point with two vectors: a dense embedding (semantic)
and a sparse term-frequency map (lexical). Queries run both channels and fuse
the results with reciprocal rank fusion, giving ES-like full-text behaviour
plus semantic recall.
"""

import hashlib
import logging
import struct
import uuid
from dataclasses import dataclass

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
        if await self._client.collection_exists(settings.QDRANT_COLLECTION):
            return
        await self._client.create_collection(
            collection_name=settings.QDRANT_COLLECTION,
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
        logger.info("created qdrant collection %s", settings.QDRANT_COLLECTION)

    async def upsert(
        self,
        post_id: str,
        title: str,
        body: str,
        summary: str,
        tags: list[str],
        created_at: str,
    ) -> None:
        text = self._embedding_text(title, body, summary)
        dense = (await self._embeddings.embed([text]))[0]
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

    async def search(self, query: str, offset: int, limit: int) -> SearchResult:
        dense = (await self._embeddings.embed([query]))[0]
        sparse = sparse_embed(query)

        # Fetch the whole fused ranking in one pass, capped at the
        # searchable window, then slice the requested page out of it.
        # Qdrant 1.19 does not expose a total count for query points, so
        # this is the only way to report an exact total, and it keeps
        # every page of the same query on a single stable ranking.
        window = settings.SEARCH_MAX_RESULT_WINDOW
        if sparse:
            response = await self._client.query_points(
                collection_name=settings.QDRANT_COLLECTION,
                prefetch=[
                    models.Prefetch(
                        query=dense,
                        using=DENSE_VECTOR,
                        limit=window,
                        score_threshold=settings.SEARCH_DENSE_SCORE_THRESHOLD,
                    ),
                    models.Prefetch(
                        query=_sparse_vector(sparse),
                        using=SPARSE_VECTOR,
                        limit=window,
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
                score_threshold=settings.SEARCH_DENSE_SCORE_THRESHOLD,
                limit=window,
            )

        post_ids = [_post_id_from_point(point.id) for point in response.points]
        return SearchResult(
            post_ids=post_ids[offset : offset + limit], total=len(post_ids)
        )

    def _embedding_text(self, title: str, body: str, summary: str) -> str:
        body_text = clean_html(body)[: settings.EMBEDDING_MAX_CHARS]
        text = " ".join(part for part in (title, body_text, summary) if part)
        return text[: settings.EMBEDDING_MAX_CHARS]

    async def close(self) -> None:
        await self._client.close()
