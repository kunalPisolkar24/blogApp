"""Session resume and stateless behavior for the compiled chat graph."""

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from src.graphs.chat_graph import build_chat_graph, graph_config_for
from src.llm import FakeLLMClient


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

    assert [m.content for m in result["messages"]] == [
        "first question",
        "second question",
    ]


async def test_threads_are_isolated_from_each_other(graph_factory) -> None:
    graph = graph_factory(InMemorySaver())

    await graph.ainvoke({"query": "mine", "top_k": 1}, graph_config_for("thread-a"))
    other = await graph.ainvoke(
        {"query": "theirs", "top_k": 1}, graph_config_for("thread-b")
    )

    assert [m.content for m in other["messages"]] == ["theirs"]


async def test_stateless_graph_never_accumulates(graph_factory) -> None:
    stateless = graph_factory()

    await stateless.ainvoke({"query": "one", "top_k": 1})
    second = await stateless.ainvoke({"query": "two", "top_k": 1})

    # Each run starts fresh; nothing carries over between calls.
    assert [m.content for m in second["messages"]] == ["two"]


def test_graph_config_for_maps_thread_ids() -> None:
    assert graph_config_for("") is None
    assert graph_config_for("chat-9") == {"configurable": {"thread_id": "chat-9"}}
