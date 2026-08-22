"""History compaction: reducer semantics, node behavior, and the
long-conversation budget acceptance."""

from langgraph.checkpoint.memory import InMemorySaver
from prometheus_client import REGISTRY

from src.domain.prompts import HISTORY_SUMMARY_PROMPT
from src.graphs.chat_graph import build_chat_graph
from src.graphs.nodes import make_compact_history
from src.graphs.state import (
    ChatMessage,
    MessageReplacement,
    merge_messages,
)
from src.llm import CompletionReply, FakeLLMClient, LLMError


def _msg(role: str, content: str) -> ChatMessage:
    return ChatMessage(role=role, content=content)


def _compactions() -> float:
    value = REGISTRY.get_sample_value("chat_compactions_total")
    return value or 0.0


def test_merge_messages_appends_by_default() -> None:
    current = [_msg("user", "one")]
    merged = merge_messages(current, [_msg("assistant", "two")])

    assert [m.content for m in merged] == ["one", "two"]
    assert not isinstance(merged, MessageReplacement)


def test_merge_messages_replaces_on_sentinel() -> None:
    current = [_msg("user", str(i)) for i in range(9)]
    replacement = MessageReplacement([_msg("summary", "condensed")])

    merged = merge_messages(current, replacement)

    assert [m.content for m in merged] == ["condensed"]


class ScriptedLLM:
    """Deterministic replies per system prompt, counting summarizations."""

    def __init__(
        self, summary: str = "rolled-up context", error: Exception | None = None
    ):
        self.summary = summary
        self.error = error
        self.summarize_calls: list[str] = []

    async def generate_completion(self, system: str, user: str) -> str:
        if system == HISTORY_SUMMARY_PROMPT:
            if self.error is not None:
                raise self.error
            self.summarize_calls.append(user)
            return self.summary
        if system == HISTORY_SUMMARY_PROMPT + "-never":
            raise AssertionError("unreachable")
        return "rewritten"

    async def generate_stream(self, system: str, user: str):
        yield "answer"

    async def generate_tool_completion(self, messages, tools):
        return CompletionReply(content=None)


async def test_compact_history_noop_under_threshold() -> None:
    llm = ScriptedLLM()
    node = make_compact_history(llm)
    state = {"messages": [_msg("user", str(i)) for i in range(6)]}

    before = _compactions()
    result = await node(state)

    assert result == {}
    assert llm.summarize_calls == []
    assert _compactions() == before


async def test_compact_history_folds_older_turns() -> None:
    llm = ScriptedLLM(summary="everything so far")
    node = make_compact_history(llm)
    messages = [_msg("user", str(i)) for i in range(9)]
    before = _compactions()

    result = await node({"messages": list(messages)})

    replacement = result["messages"]
    assert isinstance(replacement, MessageReplacement)
    folded = list(replacement)
    assert folded[0] == _msg("summary", "everything so far")
    assert [m.content for m in folded[1:]] == ["3", "4", "5", "6", "7", "8"]
    assert len(folded[1:]) == 6
    assert _compactions() == before + 1
    # The summarization prompt saw the folded turns.
    assert (
        "0:" in llm.summarize_calls[0] or "Turns to condense" in llm.summarize_calls[0]
    )


async def test_compact_history_seeds_prior_summary() -> None:
    llm = ScriptedLLM(summary="second generation")
    node = make_compact_history(llm)
    messages = [
        _msg("summary", "earlier rollup"),
        *[_msg("assistant", str(i)) for i in range(9)],
    ]

    await node({"messages": messages})

    prompt = llm.summarize_calls[0]
    assert "Summary so far:" in prompt
    assert "earlier rollup" in prompt


async def test_compact_history_skips_on_llm_error() -> None:
    llm = ScriptedLLM(error=LLMError("provider down"))
    node = make_compact_history(llm)
    messages = [_msg("user", str(i)) for i in range(9)]
    before = _compactions()

    result = await node({"messages": messages})

    assert result == {}
    assert _compactions() == before


async def test_compact_history_skips_on_empty_summary() -> None:
    llm = ScriptedLLM(summary="   ")
    node = make_compact_history(llm)

    result = await node({"messages": [_msg("user", str(i)) for i in range(9)]})

    assert result == {}


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


async def test_twenty_turn_conversation_stays_within_budget() -> None:
    llm = FakeLLMClient()
    graph = build_chat_graph(
        llm, StubStore(), StubEmbeddings(), checkpointer=InMemorySaver()
    )
    config = {"configurable": {"thread_id": "long-chat"}}
    budget = 6  # settings.CHAT_MAX_HISTORY_TURNS

    for i in range(1, 21):
        result = await graph.ainvoke({"query": f"question {i}", "top_k": 1}, config)
        # Every turn leaves the persisted conversation bounded...
        assert len(result["messages"]) <= budget + 2, (
            f"turn {i}: {len(result['messages'])} messages"
        )
        # ...with at most one summary turn, never duplicated.
        summaries = [m for m in result["messages"] if m.role == "summary"]
        assert len(summaries) <= 1

    final = await graph.ainvoke({"query": "still going", "top_k": 1}, config)
    assert len(final["messages"]) <= budget + 2
    assert _compactions() >= 1
