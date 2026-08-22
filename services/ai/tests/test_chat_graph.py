import logging

import pytest

from src.domain.prompts import JUDGE_RELEVANCE_PROMPT, REWRITE_QUERY_PROMPT
from src.graphs.chat_graph import build_chat_graph
from src.graphs.nodes import (
    make_judge_relevance,
    make_retrieve,
    route_after_judge,
)
from src.graphs.state import RelevanceVerdict
from src.llm import CompletionReply
from src.vector import RetrievedPost, SearchResult


class ScriptedLLM:
    """LLM stub that replies per system prompt from scripted queues."""

    def __init__(
        self, rewrites: list[str] | None = None, verdicts: list[str] | None = None
    ) -> None:
        self.rewrites = list(rewrites or [])
        self.verdicts = list(verdicts or [])
        self.rewrite_calls = 0
        self.judge_calls = 0

    async def generate_completion(self, system: str, user: str) -> str:
        if system == REWRITE_QUERY_PROMPT:
            self.rewrite_calls += 1
            return self.rewrites.pop(0) if self.rewrites else "rewritten query"
        if system == JUDGE_RELEVANCE_PROMPT:
            self.judge_calls += 1
            return (
                self.verdicts.pop(0)
                if self.verdicts
                else '{"relevant": true, "score": 1.0}'
            )
        raise AssertionError(f"unexpected prompt: {system}")

    async def generate_tool_completion(
        self, messages: list[dict], tools: list[dict]
    ) -> CompletionReply:
        return CompletionReply(content="grounded enough")

    async def generate_stream(self, system: str, user: str):
        raise AssertionError("chat graph does not stream yet")
        yield ""


class StubEmbeddings:
    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [[0.1] * 4 for _ in texts]


class StubSearch:
    """Search stub serving scripted results for the dense and hybrid channels."""

    def __init__(
        self,
        dense_rounds: list[list[RetrievedPost]],
        hybrid_rounds: list[list[str]] | None = None,
    ) -> None:
        self.dense_rounds = list(dense_rounds)
        self.hybrid_rounds = list(hybrid_rounds or [])
        self.calls: list[tuple[str, int]] = []

    async def retrieve_by_vector(
        self, vector: list[float], top_k: int
    ) -> list[RetrievedPost]:
        self.calls.append(("dense", top_k))
        return self.dense_rounds.pop(0) if self.dense_rounds else []

    async def search(self, query: str, offset: int, limit: int):
        self.calls.append(("hybrid", limit))
        post_ids = self.hybrid_rounds.pop(0) if self.hybrid_rounds else []
        return SearchResult(post_ids=post_ids, total=len(post_ids))

    async def get_posts(self, post_ids: list[str]) -> list[RetrievedPost]:
        return [_post(post_id) for post_id in post_ids]


def _post(post_id: str) -> RetrievedPost:
    return RetrievedPost(post_id=post_id, title=f"t {post_id}", body=f"b {post_id}")


async def test_judge_parses_verdict_and_logs(caplog) -> None:
    node = make_judge_relevance(
        ScriptedLLM(verdicts=['{"relevant": false, "score": 0.3}'])
    )

    with caplog.at_level(logging.INFO, logger="src.graphs.nodes"):
        result = await node({"query": "q", "retrieved": [_post("a")]})

    assert result["judge"].relevant is False
    assert result["judge"].score == 0.3
    assert any(r.message == "retrieval judged" for r in caplog.records)


async def test_judge_falls_open_on_unparseable_reply() -> None:
    node = make_judge_relevance(ScriptedLLM(verdicts=["the posts look fine"]))

    result = await node({"query": "q", "retrieved": []})

    assert result["judge"].relevant is True
    assert "unparseable" in result["judge"].reason


async def test_retrieve_prefers_rewritten_query_and_counts_rounds() -> None:
    search = StubSearch(dense_rounds=[[_post("a")]])
    node = make_retrieve(search, StubEmbeddings())
    state = {
        "query": "raw question",
        "rewritten_query": "standalone question",
        "top_k": 3,
        "retrieval_rounds": 1,
    }

    result = await node(state)

    assert sorted(search.calls) == [("dense", 3), ("hybrid", 3)]
    assert [post.post_id for post in result["retrieved"]] == ["a"]
    assert result["retrieval_rounds"] == 2


async def test_retrieve_caps_bodies_to_context_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("src.config.settings.CHAT_MAX_CONTEXT_CHARS", 10)
    long_post = RetrievedPost(post_id="a", title="t", body="x" * 1000)
    node = make_retrieve(StubSearch([[long_post]]), StubEmbeddings())

    result = await node({"query": "q", "thread_id": "", "top_k": 1})

    assert result["retrieved"][0].body == "x" * 10


def test_router_loops_within_budget_then_answers() -> None:
    failing = RelevanceVerdict(relevant=False)
    relevant = RelevanceVerdict(relevant=True)

    # A failing verdict with budget left loops back through the rewrite.
    assert (
        route_after_judge({"judge": failing, "retrieval_rounds": 1}) == "rewrite_query"
    )
    # Budget spent moves on even on a failing verdict...
    assert route_after_judge({"judge": failing, "retrieval_rounds": 2}) == "answer"
    # ...and a passing verdict always moves on.
    assert route_after_judge({"judge": relevant, "retrieval_rounds": 2}) == "answer"


async def test_loop_terminates_after_spending_rewrite_budget() -> None:
    llm = ScriptedLLM(
        verdicts=[
            '{"relevant": false, "score": 0.1}',
            '{"relevant": false, "score": 0.2}',
        ]
    )
    search = StubSearch([[_post("a"), _post("b")], [_post("b"), _post("c")]])
    graph = build_chat_graph(llm, search, StubEmbeddings())

    result = await graph.ainvoke({"query": "vague", "thread_id": "", "top_k": 2})

    # Two rounds ran, the rewrite budget was spent exactly, and the
    # retrieved contexts accumulated without duplicates.
    assert llm.rewrite_calls == 2
    assert llm.judge_calls == 2
    assert result["retrieval_rounds"] == 2
    assert [post.post_id for post in result["retrieved"]] == ["a", "b", "c"]
    assert result["rewritten_query"] == "rewritten query"


async def test_loop_converges_on_second_verdict() -> None:
    llm = ScriptedLLM(
        verdicts=[
            '{"relevant": false, "score": 0.2}',
            '{"relevant": true, "score": 0.8}',
        ]
    )
    graph = build_chat_graph(llm, StubSearch([[_post("a")]]), StubEmbeddings())

    result = await graph.ainvoke({"query": "vague", "thread_id": "", "top_k": 1})

    assert llm.rewrite_calls == 2
    assert llm.judge_calls == 2
    assert result["judge"].relevant is True
    assert result["retrieval_rounds"] == 2


async def test_single_pass_skips_the_loop() -> None:
    llm = ScriptedLLM()
    graph = build_chat_graph(llm, StubSearch([[_post("a")]]), StubEmbeddings())

    result = await graph.ainvoke(
        {"query": "clear question", "thread_id": "", "top_k": 1}
    )

    assert llm.rewrite_calls == 1
    assert llm.judge_calls == 1
    assert result["retrieval_rounds"] == 1
    assert [post.post_id for post in result["retrieved"]] == ["a"]
