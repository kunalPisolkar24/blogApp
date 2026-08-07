import httpx
import pytest

from src.config import settings
from src.embeddings import EmbeddingError, OllamaEmbeddingClient, _validate_embeddings


def _vector() -> list[float]:
    return [0.0] * settings.QDRANT_VECTOR_SIZE


def _client(payload) -> OllamaEmbeddingClient:
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
    return OllamaEmbeddingClient(
        httpx.AsyncClient(
            base_url="http://embedding-service:11434", transport=transport
        )
    )


def test_validate_accepts_matching_embeddings() -> None:
    _validate_embeddings(["a", "b"], [_vector(), _vector()])


def test_validate_rejects_wrong_count() -> None:
    with pytest.raises(EmbeddingError, match="expected 2 embeddings, got 1"):
        _validate_embeddings(["a", "b"], [_vector()])


def test_validate_rejects_wrong_dimension() -> None:
    with pytest.raises(EmbeddingError, match="dimension"):
        _validate_embeddings(["a"], [[0.0] * (settings.QDRANT_VECTOR_SIZE - 1)])


async def test_ollama_embed_returns_vectors() -> None:
    client = _client({"embeddings": [_vector()]})
    try:
        vectors = await client.embed(["hello"])
    finally:
        await client.close()

    assert vectors == [_vector()]


async def test_ollama_embed_rejects_wrong_count() -> None:
    client = _client({"embeddings": []})
    try:
        with pytest.raises(EmbeddingError, match="expected 1 embeddings, got 0"):
            await client.embed(["hello"])
    finally:
        await client.close()


async def test_ollama_embed_surfaces_transport_errors() -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(503))
    client = OllamaEmbeddingClient(httpx.AsyncClient(transport=transport))
    try:
        with pytest.raises(EmbeddingError):
            await client.embed(["hello"])
    finally:
        await client.close()
