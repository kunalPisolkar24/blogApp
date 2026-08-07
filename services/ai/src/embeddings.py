import hashlib
import logging
import math
import random
import time
from typing import Protocol

import httpx

from src.config import settings
from src.observability import metrics

logger = logging.getLogger(__name__)


class EmbeddingError(Exception):
    """Raised when the embedding provider fails or returns a bad shape."""


class EmbeddingProvider(Protocol):
    """Anything that turns texts into dense vectors."""

    async def embed(self, texts: list[str]) -> list[list[float]]: ...

    async def close(self) -> None: ...


def _chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


class OllamaEmbeddingClient:
    """Embeds text via a self-hosted Ollama server (native /api/embed)."""

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or httpx.AsyncClient(
            base_url=settings.EMBEDDING_URL,
            timeout=settings.EMBEDDING_TIMEOUT_SECONDS,
        )

    async def embed(self, texts: list[str]) -> list[list[float]]:
        start = time.perf_counter()
        try:
            vectors = await self._embed(texts)
            _validate_embeddings(texts, vectors)
            metrics.EMBEDDING_REQUESTS.labels(status="success").inc()
        except EmbeddingError:
            metrics.EMBEDDING_REQUESTS.labels(status="error").inc()
            raise
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            metrics.EMBEDDING_REQUESTS.labels(status="error").inc()
            raise EmbeddingError(str(exc)) from exc
        finally:
            metrics.EMBEDDING_REQUEST_DURATION.observe(time.perf_counter() - start)
        return vectors

    async def _embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for batch in _chunked(texts, settings.EMBEDDING_BATCH_SIZE):
            response = await self._client.post(
                "/api/embed",
                json={"model": settings.EMBEDDING_MODEL, "input": batch},
            )
            response.raise_for_status()
            vectors.extend(response.json()["embeddings"])
        return vectors

    async def close(self) -> None:
        await self._client.aclose()


def _validate_embeddings(texts: list[str], vectors: list[list[float]]) -> None:
    """Reject mismatched embedding responses before they can corrupt the
    index: the count must match the input and the dimension must match
    the configured dense vector size."""
    if len(vectors) != len(texts):
        raise EmbeddingError(f"expected {len(texts)} embeddings, got {len(vectors)}")
    if any(len(vector) != settings.QDRANT_VECTOR_SIZE for vector in vectors):
        raise EmbeddingError(
            f"embedding dimension must be {settings.QDRANT_VECTOR_SIZE}"
        )


class FakeEmbeddingClient:
    """Deterministic unit-norm vectors for tests and load testing.

    Vectors are zero-mean gaussians normalised to unit length, seeded
    per text. Cosine similarity is therefore ~0 for unrelated texts and
    exactly 1 for identical texts, mirroring how a real embedding model
    behaves well enough for the search score threshold to matter.
    """

    def __init__(self) -> None:
        self._size = settings.QDRANT_VECTOR_SIZE

    async def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for text in texts:
            seed = int(hashlib.sha256(text.encode()).hexdigest(), 16) % (2**32)
            rng = random.Random(seed)
            vector = [rng.gauss(0, 1) for _ in range(self._size)]
            norm = math.sqrt(sum(component**2 for component in vector))
            vectors.append([component / norm for component in vector])
        return vectors

    async def close(self) -> None:
        return None
