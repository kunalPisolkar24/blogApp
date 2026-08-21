from prometheus_client import REGISTRY

from src.domain.prompts import REWRITE_QUERY_PROMPT, rewrite_query_user_prompt
from src.graphs.nodes import make_rewrite_query
from src.graphs.state import ChatMessage
from src.llm import FakeLLMClient, LLMError


def _rewrite_metric(outcome: str) -> float:
    value = REGISTRY.get_sample_value("query_rewrites_total", {"outcome": outcome})
    return value or 0.0


async def test_rewrite_produces_searchable_query() -> None:
    node = make_rewrite_query(FakeLLMClient())
    state = {
        "query": "wats the deal wit langgraph checkpoints??",
        "thread_id": "",
    }
    before = _rewrite_metric("rewritten")

    result = await node(state)

    assert result["rewritten_query"] == FakeLLMClient._REWRITE_QUERY
    assert state["query"] == "wats the deal wit langgraph checkpoints??"
    assert _rewrite_metric("rewritten") == before + 1


async def test_history_is_included_in_the_prompt() -> None:
    calls: list[tuple[str, str]] = []

    class CapturingLLM:
        async def generate_completion(self, system: str, user: str) -> str:
            calls.append((system, user))
            return "standalone rewritten query"

    node = make_rewrite_query(CapturingLLM())
    state = {
        "query": "what about its pricing?",
        "thread_id": "",
        "messages": [
            ChatMessage(role="user", content="How does tagging work?"),
            ChatMessage(role="assistant", content="Tags categorize posts."),
        ],
    }

    result = await node(state)

    assert result["rewritten_query"] == "standalone rewritten query"
    system, user = calls[0]
    assert system == REWRITE_QUERY_PROMPT
    assert user == rewrite_query_user_prompt(
        "what about its pricing?",
        [
            ("user", "How does tagging work?"),
            ("assistant", "Tags categorize posts."),
        ],
    )
    assert "How does tagging work?" in user


async def test_empty_rewrite_keeps_original() -> None:
    class EmptyLLM:
        async def generate_completion(self, system: str, user: str) -> str:
            return "   "

    original = "vague question"
    node = make_rewrite_query(EmptyLLM())

    result = await node({"query": original, "thread_id": ""})

    assert result["rewritten_query"] == original
    assert _rewrite_metric("kept_original") > 0.0


async def test_llm_failure_keeps_original() -> None:
    class FailingLLM:
        async def generate_completion(self, system: str, user: str) -> str:
            raise LLMError("provider down")

    original = "vague question"
    node = make_rewrite_query(FailingLLM())

    result = await node({"query": original, "thread_id": ""})

    assert result["rewritten_query"] == original
    assert _rewrite_metric("kept_original") > 0.0


def test_rewrite_node_is_traceable() -> None:
    node = make_rewrite_query(FakeLLMClient())
    assert hasattr(node, "__wrapped__")
