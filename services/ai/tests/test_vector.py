"""Unit tests for SearchIndex collection bootstrapping.

ensure_collection must create the posts and users collections on a fresh
store, and must never touch a collection that already exists, so a
pre-existing posts collection keeps its data and configuration.
"""

import pytest
from qdrant_client import AsyncQdrantClient, models

from src.config import settings
from src.embeddings import FakeEmbeddingClient
from src.vector import DENSE_VECTOR, SPARSE_VECTOR, SearchIndex


@pytest.fixture
async def index() -> tuple[SearchIndex, AsyncQdrantClient]:
    client = AsyncQdrantClient(location=":memory:")
    index = SearchIndex(FakeEmbeddingClient(), client)
    yield index, client
    await index.close()


async def test_ensure_collection_creates_posts_and_users(
    index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, client = index

    await search.ensure_collection()

    assert await client.collection_exists(settings.QDRANT_COLLECTION)
    assert await client.collection_exists(settings.QDRANT_USERS_COLLECTION)


async def test_ensure_collection_uses_the_shared_vector_config(
    index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, client = index

    await search.ensure_collection()

    for name in (settings.QDRANT_COLLECTION, settings.QDRANT_USERS_COLLECTION):
        info = await client.get_collection(name)
        dense = info.config.params.vectors[DENSE_VECTOR]
        assert isinstance(dense, models.VectorParams)
        assert dense.size == settings.QDRANT_VECTOR_SIZE
        assert dense.distance == models.Distance.COSINE
        sparse = info.config.params.sparse_vectors[SPARSE_VECTOR]
        assert isinstance(sparse, models.SparseVectorParams)
        assert sparse.modifier == models.Modifier.IDF


async def test_ensure_collection_leaves_existing_posts_untouched(
    index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    """A posts collection created elsewhere must keep its configuration,
    while the users collection still gets created."""
    search, client = index
    await client.create_collection(
        collection_name=settings.QDRANT_COLLECTION,
        vectors_config=models.VectorParams(size=8, distance=models.Distance.DOT),
    )

    await search.ensure_collection()

    posts = await client.get_collection(settings.QDRANT_COLLECTION)
    assert posts.config.params.vectors == models.VectorParams(
        size=8, distance=models.Distance.DOT
    )
    assert await client.collection_exists(settings.QDRANT_USERS_COLLECTION)
