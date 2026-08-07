"""BM25-style sparse embeddings.

Sparse vectors carry lexical term-frequency signals and complement the
dense semantic vectors. Qdrant applies collection-level IDF on top of the
raw term frequencies (`sparse_vectors: {modifier: idf}`), so we only need
to produce `{token: tf}` weight maps.

Prefix tokens (e.g. "grpc" -> "grp", "grpc") give typo tolerance: a query
token that diverges from the stored token still shares its prefixes.
"""

import re
from collections import Counter

from snowballstemmer import stemmer

from src.config import settings

_WORD_RE = re.compile(r"[a-z0-9]+")
_ENGLISH = stemmer("english")


def tokenize(text: str) -> list[str]:
    words = _WORD_RE.findall(text.lower())
    return [
        _ENGLISH.stemWord(word)
        for word in words
        if len(word) >= settings.SPARSE_MIN_TOKEN_LENGTH
    ]


def embed(text: str) -> dict[str, float]:
    """Term-frequency weights with prefix tokens, capped at a token budget."""
    tokens = tokenize(text)
    if not tokens:
        return {}

    sparse: dict[str, float] = {}
    for token, tf in Counter(tokens).most_common():
        sparse[token] = sparse.get(token, 0.0) + tf
        for length in range(settings.SPARSE_PREFIX_MIN_LENGTH, len(token)):
            prefix = token[:length]
            sparse[prefix] = sparse.get(prefix, 0.0) + tf
        if len(sparse) >= settings.SPARSE_MAX_TOKENS:
            break
    return sparse
