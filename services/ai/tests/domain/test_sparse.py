from src.sparse import embed, tokenize


def test_tokenize_lowercases_and_splits() -> None:
    assert tokenize("gRPC  Client, KEEPALIVE!") == ["grpc", "client", "keepal"]


def test_tokenize_stems_words() -> None:
    tokens = tokenize("running runs")

    assert tokens == ["run", "run"]


def test_tokenize_drops_short_tokens() -> None:
    assert tokenize("a b") == []


def test_tokenize_ignores_non_alphanumeric() -> None:
    assert tokenize("<p>hello, world!</p>") == ["hello", "world"]


def test_embed_counts_term_frequencies() -> None:
    sparse = embed("hello world hello")

    assert sparse["hello"] == 2
    assert sparse["world"] == 1


def test_embed_adds_prefix_tokens_for_typo_tolerance() -> None:
    sparse = embed("grpc")

    assert "grpc" in sparse
    assert "grp" in sparse
    assert "gr" not in sparse


def test_embed_returns_empty_for_no_tokens() -> None:
    assert embed("!!!") == {}


def test_embed_is_deterministic() -> None:
    assert embed("kubernetes deployment") == embed("kubernetes deployment")
