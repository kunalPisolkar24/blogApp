"""Unit tests for SearchIndex bootstrapping and user profiles.

ensure_collection must create the posts and users collections on a fresh
store, and must never touch a collection that already exists, so a
pre-existing posts collection keeps its data and configuration.

update_user_profile must fold interactions into the user's point using
only the stored post vector and tags: the dense running average obeys
the interaction weights, tag and seen lists respect their caps, unknown
posts are no-ops, and no embedding call happens on this path.
"""

from datetime import UTC, datetime, timedelta

import pytest
from qdrant_client import AsyncQdrantClient, models

from src.config import settings
from src.embeddings import FakeEmbeddingClient
from src.vector import (
    DENSE_VECTOR,
    SPARSE_VECTOR,
    SearchIndex,
    SearchResult,
    _token_id,
    _user_point_id,
)
from tests.scripted_embedding import ScriptedEmbedding

POST_A = "6a75a41221a9752ec47bc60a"
POST_B = "6a75a41221a9752ec47bc60b"
POST_C = "6a75a41221a9752ec47bc60c"
POST_D = "6a75a41221a9752ec47bc60d"
UNKNOWN_POST = "6a75a41221a9752ec47bc6ff"


@pytest.fixture
async def index() -> tuple[SearchIndex, AsyncQdrantClient]:
    client = AsyncQdrantClient(location=":memory:")
    index = SearchIndex(FakeEmbeddingClient(), client)
    yield index, client
    await index.close()


@pytest.fixture
async def scripted_index() -> tuple[SearchIndex, AsyncQdrantClient]:
    """Index backed by ScriptedEmbedding for exact cosine math."""
    client = AsyncQdrantClient(location=":memory:")
    index = SearchIndex(ScriptedEmbedding(), client)
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


async def test_ensure_collection_indexes_post_created_at(
    index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    """The surprise feed's recent-posts fallback orders by created_at,
    which qdrant only allows on an indexed field. The index is created
    for the posts collection only: the users collection never orders."""
    search, client = index
    calls: list[dict] = []
    original = client.create_payload_index

    async def recording(*args, **kwargs) -> None:
        calls.append(kwargs)
        await original(*args, **kwargs)

    client.create_payload_index = recording

    await search.ensure_collection()

    assert calls == [
        {
            "collection_name": settings.QDRANT_COLLECTION,
            "field_name": "created_at",
            "field_schema": models.PayloadSchemaType.DATETIME,
        }
    ]


class _RaisesOnEmbed:
    """Embedding provider that fails the test if it is ever called."""

    async def embed(self, texts: list[str]) -> list[list[float]]:
        raise AssertionError("update_user_profile must not embed anything")

    async def close(self) -> None:
        return None


def _index_request(
    post_id: str,
    text: str,
    tags: list[str] | None = None,
    created_at: str = "2026-01-01T00:00:00Z",
):
    return {
        "post_id": post_id,
        "title": text,
        "body": f"<p>{text}</p>",
        "summary": f"summary {text}",
        "tags": tags or [],
        "created_at": created_at,
    }


async def _seed_post(
    index: SearchIndex,
    post_id: str,
    text: str,
    tags: list[str] | None = None,
    created_at: str = "2026-01-01T00:00:00Z",
) -> None:
    await index.upsert(**_index_request(post_id, text, tags, created_at))


async def _user_points(client: AsyncQdrantClient) -> list[models.Record]:
    response = await client.scroll(
        collection_name=settings.QDRANT_USERS_COLLECTION, limit=10, with_vectors=True
    )
    return response[0]


async def _fold(index: SearchIndex, user_id: str, post_id: str, weight: float) -> None:
    await index.update_user_profile(user_id, post_id, weight)


async def test_update_user_profile_creates_a_point_with_folded_state(
    index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, client = index
    await search.ensure_collection()
    await _seed_post(search, POST_A, "beta doc", ["go", "grpc"])

    await _fold(search, "user-1", POST_A, 1.0)

    points = await _user_points(client)
    assert len(points) == 1
    payload = points[0].payload
    assert payload["total_weight"] == 1.0
    assert payload["tag_weights"] == {"go": 1.0, "grpc": 1.0}
    assert payload["seen_post_ids"] == [POST_A]
    assert "updated_at" in payload


async def test_update_user_profile_averages_across_posts(
    scripted_index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, client = scripted_index
    await search.ensure_collection()
    await _seed_post(search, POST_A, "alpha doc")
    await _seed_post(search, POST_B, "beta doc")

    await _fold(search, "user-1", POST_A, 1.0)
    await _fold(search, "user-1", POST_B, 1.0)

    points = await _user_points(client)
    assert points[0].payload["total_weight"] == 2.0
    dense = points[0].vector[DENSE_VECTOR]
    # Two equally weighted unit vectors on different axes average to
    # equal components on both axes, renormalised to unit length.
    assert dense[0] == pytest.approx(dense[1], abs=1e-6)
    assert sum(c**2 for c in dense) == pytest.approx(1.0)


async def test_update_user_profile_weights_like_higher_than_view(
    scripted_index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, client = scripted_index
    await search.ensure_collection()
    await _seed_post(search, POST_A, "alpha doc")
    await _seed_post(search, POST_B, "beta doc")

    await _fold(search, "user-1", POST_A, 1.0)
    await _fold(search, "user-1", POST_B, 3.0)

    points = await _user_points(client)
    assert points[0].payload["total_weight"] == 4.0
    # The like on post-b (weight 3) pulls the average 3x harder than the
    # view on post-a (weight 1), so the beta axis dominates the profile.
    dense = points[0].vector[DENSE_VECTOR]
    assert dense[1] == pytest.approx(3.0 * dense[0])


async def test_update_user_profile_accumulates_tag_weights(
    index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, client = index
    await search.ensure_collection()
    await _seed_post(search, POST_A, "beta doc", ["go"])

    await _fold(search, "user-1", POST_A, 1.0)
    await _fold(search, "user-1", POST_A, 3.0)

    points = await _user_points(client)
    assert points[0].payload["tag_weights"] == {"go": 4.0}


async def test_update_user_profile_caps_tag_weight(
    index: tuple[SearchIndex, AsyncQdrantClient],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "PROFILE_TAG_WEIGHT_CAP", 4.0)
    search, client = index
    await search.ensure_collection()
    await _seed_post(search, POST_A, "beta doc", ["go"])

    for _ in range(5):
        await _fold(search, "user-1", POST_A, 1.0)

    points = await _user_points(client)
    payload = points[0].payload
    assert payload["tag_weights"] == {"go": 4.0}
    assert payload["total_weight"] == 5.0, "the cap must not touch the average"


async def test_update_user_profile_evicts_the_weakest_tag_when_full(
    index: tuple[SearchIndex, AsyncQdrantClient],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "PROFILE_MAX_TAGS", 2)
    search, client = index
    await search.ensure_collection()
    await _seed_post(search, POST_A, "beta doc", ["one"])
    await _seed_post(search, POST_B, "beta doc", ["two"])
    await _seed_post(search, POST_C, "beta doc", ["three"])

    await _fold(search, "user-1", POST_A, 1.0)
    await _fold(search, "user-1", POST_B, 1.0)
    await _fold(search, "user-1", POST_C, 1.0)

    points = await _user_points(client)
    assert points[0].payload["tag_weights"] == {"two": 1.0, "three": 1.0}


async def test_update_user_profile_caps_seen_posts(
    index: tuple[SearchIndex, AsyncQdrantClient],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "PROFILE_SEEN_POSTS_CAP", 3)
    search, client = index
    await search.ensure_collection()
    for post_id in (POST_A, POST_B, POST_C, POST_D):
        await _seed_post(search, post_id, "beta doc")

    for post_id in (POST_A, POST_B, POST_C, POST_D):
        await _fold(search, "user-1", post_id, 1.0)

    points = await _user_points(client)
    assert points[0].payload["seen_post_ids"] == [POST_B, POST_C, POST_D]


async def test_update_user_profile_dedupes_seen_posts(
    index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, client = index
    await search.ensure_collection()
    await _seed_post(search, POST_A, "beta doc")
    await _seed_post(search, POST_B, "beta doc")

    await _fold(search, "user-1", POST_A, 1.0)
    await _fold(search, "user-1", POST_B, 1.0)
    await _fold(search, "user-1", POST_A, 1.0)

    points = await _user_points(client)
    assert points[0].payload["seen_post_ids"] == [POST_B, POST_A]


async def test_update_user_profile_unknown_post_is_a_noop(
    index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, client = index
    await search.ensure_collection()
    await _seed_post(search, POST_A, "beta doc")

    await _fold(search, "user-1", UNKNOWN_POST, 1.0)

    assert await _user_points(client) == []


async def test_update_user_profile_never_calls_the_embedding_provider(
    index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    """The fold must read the stored post vector, not re-embed it."""
    search, client = index
    await search.ensure_collection()
    await _seed_post(search, POST_A, "beta doc", ["go"])
    guarded = SearchIndex(_RaisesOnEmbed(), client)

    await _fold(guarded, "user-1", POST_A, 1.0)

    points = await _user_points(client)
    assert len(points) == 1


async def test_update_user_profile_stores_sparse_vector_matching_tags(
    index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, client = index
    await search.ensure_collection()
    await _seed_post(search, POST_A, "beta doc", ["go", "grpc"])

    await _fold(search, "user-1", POST_A, 1.0)

    points = await _user_points(client)
    sparse = points[0].vector[SPARSE_VECTOR]
    assert sorted(sparse.indices) == sorted([_token_id("go"), _token_id("grpc")])
    assert sparse.values == [1.0, 1.0]


def _fresh_date() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


async def _seed_fresh(index: SearchIndex, post_id: str, text: str) -> None:
    await _seed_post(index, post_id, text, created_at=_fresh_date())


async def _fold_fresh(
    index: SearchIndex, user_id: str, post_id: str, weight: float
) -> None:
    await _seed_fresh(index, post_id, "beta doc")
    await _fold(index, user_id, post_id, weight)


async def test_recommend_returns_empty_for_cold_start_user(
    scripted_index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, _ = scripted_index
    await search.ensure_collection()
    await _seed_fresh(search, POST_A, "beta doc")

    result = await search.recommend("user-1", 0, 10)

    assert result == SearchResult(post_ids=[], total=0)


async def test_recommend_returns_empty_for_empty_profile(
    index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    """A profile point with no accumulated weight carries no signal."""
    search, client = index
    await search.ensure_collection()
    await _seed_fresh(search, POST_A, "beta doc")
    await client.upsert(
        collection_name=settings.QDRANT_USERS_COLLECTION,
        points=[
            models.PointStruct(
                id=_user_point_id("user-1"),
                vector={DENSE_VECTOR: [0.0] * settings.QDRANT_VECTOR_SIZE},
                payload={"total_weight": 0.0},
            )
        ],
    )

    result = await search.recommend("user-1", 0, 10)

    assert result == SearchResult(post_ids=[], total=0)


async def test_recommend_ranks_similar_posts_first_and_excludes_seen(
    scripted_index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, _ = scripted_index
    await search.ensure_collection()
    await _seed_fresh(search, POST_A, "beta doc")
    await _seed_fresh(search, POST_B, "beta doc")
    await _seed_fresh(search, POST_C, "alpha doc")

    await _fold(search, "user-1", POST_A, 1.0)

    result = await search.recommend("user-1", 0, 10)

    # The profile points at the beta axis: the other beta post ranks
    # first, the alpha post is below the score threshold, and the
    # interacted post itself is excluded from the feed.
    assert result.post_ids == [POST_B]
    assert result.total == 1


async def test_recommend_slices_pagination_with_exact_total(
    scripted_index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, _ = scripted_index
    await search.ensure_collection()
    await _seed_fresh(search, POST_A, "alpha doc")
    await _seed_fresh(search, POST_B, "beta doc")
    await _seed_fresh(search, POST_C, "alpha doc")
    await _seed_fresh(search, POST_D, "beta doc")

    # Mixed profile: one like on beta (weight 3) outweighs one view on
    # alpha (weight 1), so beta posts rank above alpha posts.
    await _fold(search, "user-1", POST_C, 1.0)
    await _fold(search, "user-1", POST_D, 3.0)

    result = await search.recommend("user-1", 1, 1)

    assert result.post_ids == [POST_A]
    assert result.total == 2


async def test_recommend_excludes_posts_older_than_recency(
    index: tuple[SearchIndex, AsyncQdrantClient],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "RECOMMEND_RECENCY_DAYS", 60)
    search, _ = index
    await search.ensure_collection()
    await _seed_post(search, POST_B, "beta doc", created_at="2026-01-01T00:00:00Z")
    await _seed_fresh(search, POST_C, "beta doc")
    await _fold_fresh(search, "user-1", POST_A, 1.0)

    result = await search.recommend("user-1", 0, 10)

    assert result.post_ids == [POST_C]
    assert result.total == 1


async def test_recommend_excludes_posts_without_created_at(
    index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, _ = index
    await search.ensure_collection()
    await _seed_post(search, POST_B, "beta doc", created_at="")
    await _fold_fresh(search, "user-1", POST_A, 1.0)

    result = await search.recommend("user-1", 0, 10)

    assert result == SearchResult(post_ids=[], total=0)


async def test_recommend_never_calls_the_embedding_provider(
    index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    """The feed must query with the stored profile vector, not re-embed."""
    search, client = index
    await search.ensure_collection()
    await _seed_fresh(search, POST_A, "beta doc")
    await _seed_fresh(search, POST_B, "beta doc")
    await _fold(search, "user-1", POST_A, 1.0)
    guarded = SearchIndex(_RaisesOnEmbed(), client)

    result = await guarded.recommend("user-1", 0, 10)

    assert result.post_ids == [POST_B]


def _days_ago(days: int) -> str:
    return (datetime.now(UTC) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


async def test_recommend_surprise_returns_anti_taste_posts(
    scripted_index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, _ = scripted_index
    await search.ensure_collection()
    await _seed_fresh(search, POST_A, "beta doc")
    await _seed_fresh(search, POST_B, "beta doc")
    await _seed_fresh(search, POST_C, "alpha doc")
    await _fold(search, "user-1", POST_A, 1.0)

    default = await search.recommend("user-1", 0, 10)
    surprise = await search.recommend_surprise("user-1", 0, 1, seed=0)

    # The default feed surfaces the other beta post; surprise inverts the
    # profile, so the orthogonal alpha post is the only hit, and only
    # after the strict threshold relaxes from 0.1 down to 0.0.
    assert default.post_ids == [POST_B]
    assert surprise.post_ids == [POST_C]
    assert surprise.total == 1


async def test_recommend_surprise_relaxes_threshold_to_fill_the_page(
    scripted_index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, _ = scripted_index
    await search.ensure_collection()
    await _seed_fresh(search, POST_A, "alpha doc")
    await _seed_fresh(search, POST_B, "beta doc")
    await _seed_fresh(search, POST_C, "alpha doc")
    await _seed_fresh(search, POST_D, "beta doc")
    # Balanced profile: no post clears even the floor at the first pass,
    # so the page fills only once the threshold relaxes to -0.8.
    await _fold(search, "user-1", POST_A, 1.0)
    await _fold(search, "user-1", POST_B, 1.0)

    surprise = await search.recommend_surprise("user-1", 0, 2, seed=0)

    assert sorted(surprise.post_ids) == [POST_C, POST_D]
    assert surprise.total == 2


async def test_recommend_surprise_is_seed_stable(
    scripted_index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, _ = scripted_index
    await search.ensure_collection()
    await _seed_fresh(search, POST_A, "beta doc")
    await _seed_post(search, POST_B, "alpha doc", created_at=_days_ago(1))
    await _seed_post(search, POST_C, "beta doc", created_at=_days_ago(2))
    await _seed_post(search, POST_D, "alpha doc", created_at=_days_ago(3))
    await _fold(search, "user-1", POST_A, 1.0)

    first = await search.recommend_surprise("user-1", 0, 10, seed=7)
    same_seed = await search.recommend_surprise("user-1", 0, 10, seed=7)
    other_seed = await search.recommend_surprise("user-1", 0, 10, seed=11)

    assert first.post_ids == same_seed.post_ids
    assert first.post_ids != other_seed.post_ids


async def test_recommend_surprise_falls_back_to_recent_posts(
    scripted_index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, _ = scripted_index
    await search.ensure_collection()
    await _seed_fresh(search, POST_A, "beta doc")
    await _seed_post(search, POST_B, "beta doc", created_at=_days_ago(1))
    await _seed_post(search, POST_C, "beta doc", created_at=_days_ago(2))
    await _fold(search, "user-1", POST_A, 1.0)

    # Every candidate is exactly the user's taste: the negated query
    # scores them -1.0, below even the floor, so the feed falls back to
    # the newest posts.
    surprise = await search.recommend_surprise("user-1", 0, 2, seed=0)

    assert sorted(surprise.post_ids) == [POST_B, POST_C]
    assert surprise.total == 2


async def test_recommend_surprise_excludes_seen_and_stale_posts(
    index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, _ = index
    await search.ensure_collection()
    await _seed_post(search, POST_B, "beta doc", created_at="2026-01-01T00:00:00Z")
    await _seed_fresh(search, POST_C, "alpha doc")
    await _fold_fresh(search, "user-1", POST_A, 1.0)

    surprise = await search.recommend_surprise("user-1", 0, 1, seed=0)

    assert surprise.post_ids == [POST_C]
    assert surprise.total == 1


async def test_recommend_surprise_returns_empty_for_cold_start_user(
    scripted_index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, _ = scripted_index
    await search.ensure_collection()
    await _seed_fresh(search, POST_A, "beta doc")

    result = await search.recommend_surprise("user-1", 0, 10, seed=0)

    assert result == SearchResult(post_ids=[], total=0)


async def test_recommend_surprise_never_calls_the_embedding_provider(
    index: tuple[SearchIndex, AsyncQdrantClient],
) -> None:
    search, client = index
    await search.ensure_collection()
    await _seed_fresh(search, POST_A, "beta doc")
    await _seed_fresh(search, POST_B, "beta doc")
    await _seed_fresh(search, POST_C, "alpha doc")
    await _fold(search, "user-1", POST_A, 1.0)
    guarded = SearchIndex(_RaisesOnEmbed(), client)

    result = await guarded.recommend_surprise("user-1", 0, 1, seed=0)

    assert result.post_ids == [POST_C]
