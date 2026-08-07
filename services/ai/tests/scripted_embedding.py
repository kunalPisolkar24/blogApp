from src.config import settings


class ScriptedEmbedding:
    """Embedding provider with two hand-crafted unit vectors.

    Documents containing "beta" map to axis 1, everything else to axis 0,
    so the cosine similarity between the two groups is exactly 0 and
    within a group exactly 1.
    """

    async def embed(self, texts: list[str]) -> list[list[float]]:
        vectors = []
        for text in texts:
            vectors.append(self._unit(1 if "beta" in text else 0))
        return vectors

    async def close(self) -> None:
        return None

    @staticmethod
    def _unit(axis: int) -> list[float]:
        vector = [0.0] * settings.QDRANT_VECTOR_SIZE
        vector[axis] = 1.0
        return vector
