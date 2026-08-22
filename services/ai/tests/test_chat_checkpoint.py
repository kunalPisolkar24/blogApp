"""Session resume and stateless behavior for the compiled chat graph."""

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from src.graphs.chat_graph import build_chat_graph, graph_config_for
from src.graphs.state import ChatMessage
from src.llm import FakeLLMClient
from src.vector import SearchResult


class StubEmbeddings:
    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [[0.1] * 4 for _ in texts]


class StubStore:
    async def retrieve_by_vector(self, vector: list[float], top_k: int):
        return []

    async def search(self, query: str, offset: int, limit: int):
        from src.vector import SearchResult

        return SearchResult(post_ids=[], total=0)

    async def get_posts(self, post_ids: list[str]):
        return []


@pytest.fixture
def graph_factory():
    def _build(checkpointer=None):
        return build_chat_graph(
            FakeLLMClient(), StubStore(), StubEmbeddings(), checkpointer=checkpointer
        )

    return _build


async def test_session_resumes_messages_across_calls(graph_factory) -> None:
    graph = graph_factory(InMemorySaver())

    await graph.ainvoke(
        {"query": "first question", "top_k": 1}, graph_config_for("chat-1")
    )
    result = await graph.ainvoke(
        {"query": "second question", "top_k": 1}, graph_config_for("chat-1")
    )

    # Assistant answers are recorded too; the questions prove resumption.
    assert [m.content for m in result["messages"] if m.role == "user"] == [
        "first question",
        "second question",
    ]
    assert [m.role for m in result["messages"]] == [
        "user",
        "assistant",
        "user",
        "assistant",
    ]


async def test_threads_are_isolated_from_each_other(graph_factory) -> None:
    graph = graph_factory(InMemorySaver())

    await graph.ainvoke({"query": "mine", "top_k": 1}, graph_config_for("thread-a"))
    other = await graph.ainvoke(
        {"query": "theirs", "top_k": 1}, graph_config_for("thread-b")
    )

    assert [m.content for m in other["messages"] if m.role == "user"] == ["theirs"]


async def test_stateless_graph_never_accumulates(graph_factory) -> None:
    stateless = graph_factory()

    await stateless.ainvoke({"query": "one", "top_k": 1})
    second = await stateless.ainvoke({"query": "two", "top_k": 1})

    # Each run starts fresh; nothing carries over between calls.
    assert [m.content for m in second["messages"] if m.role == "user"] == ["two"]


def test_graph_config_for_maps_thread_ids() -> None:
    assert graph_config_for("") is None
    assert graph_config_for("chat-9") == {"configurable": {"thread_id": "chat-9"}}


def test_checkpoint_serde_preserves_state_dataclasses() -> None:
    """Every custom type stored in ChatState channels must survive the
    checkpoint serializer: a missing msgpack allowlist entry silently
    degrades stored objects to raw dicts when a session reloads."""
    from src.graphs.checkpointer import build_checkpointer
    from src.vector import RetrievedPost

    saver = build_checkpointer()
    blob, checksum = saver.serde.dumps_typed(
        [
            ("messages", 1, [ChatMessage(role="user", content="hi")]),
            (
                "retrieved",
                1,
                [RetrievedPost(post_id="a", title="t", body="b")],
            ),
            ("judge", 1, None),
        ]
    )
    loaded = {
        name: value for name, _, value in saver.serde.loads_typed((blob, checksum))
    }

    assert isinstance(loaded["messages"][0], ChatMessage)
    assert isinstance(loaded["retrieved"][0], RetrievedPost)


async def test_sessions_do_not_inherit_stale_grounding() -> None:
    """A later turn's citations must reflect only its own retrieval:
    turn 2 on the same thread retrieves different posts and must not
    see turn 1's context merged in."""

    class RoundStore:
        def __init__(self) -> None:
            from src.vector import RetrievedPost as RP

            self.rounds = [
                [RP(post_id="a", title="t a", body="b a")],
                [RP(post_id="b", title="t b", body="b b")],
            ]

        async def retrieve_by_vector(self, vector, top_k):
            return self.rounds.pop(0) if self.rounds else []

        async def search(self, query: str, offset: int, limit: int):
            return SearchResult(post_ids=[], total=0)

        async def get_posts(self, post_ids):
            return []

    store = RoundStore()
    graph = build_chat_graph(FakeLLMClient(), store, StubEmbeddings())
    config = {"configurable": {"thread_id": "grounding-thread"}}

    first = await graph.ainvoke({"query": "first topic", "top_k": 1}, config)
    second = await graph.ainvoke({"query": "second topic", "top_k": 1}, config)

    assert [p.post_id for p in first["retrieved"]] == ["a"]
    assert [p.post_id for p in second["retrieved"]] == ["b"]
    assert [m.role for m in second["messages"]] == ["user", "assistant"]
