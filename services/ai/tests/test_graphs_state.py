import pytest
from langgraph.graph import END, START, StateGraph

from src.graphs.state import (
    AnswerOutput,
    ChatMessage,
    ChatState,
    JudgeOutput,
    RelevanceVerdict,
    RetrieveOutput,
    RewriteQueryOutput,
    ToolCall,
    ToolLoopOutput,
    merge_retrieved,
)
from src.vector import RetrievedPost


def _post(post_id: str) -> RetrievedPost:
    return RetrievedPost(post_id=post_id, title=f"t {post_id}", body=f"b {post_id}")


def test_merge_retrieved_appends_new_posts_in_order() -> None:
    current = [_post("a")]
    incoming = [_post("b"), _post("c")]

    merged = merge_retrieved(current, incoming)

    assert [post.post_id for post in merged] == ["a", "b", "c"]


def test_merge_retrieved_skips_known_post_ids() -> None:
    current = [_post("a"), _post("b")]
    incoming = [_post("b"), _post("c"), _post("a")]

    merged = merge_retrieved(current, incoming)

    assert [post.post_id for post in merged] == ["a", "b", "c"]


@pytest.mark.asyncio
async def test_state_composes_across_node_hops() -> None:
    """A tiny retrieve -> judge -> rewrite loop exercises every channel:
    accumulating fields must compose across hops while single-writer
    fields keep only the latest value."""

    async def retrieve_round_1(state: ChatState) -> RetrieveOutput:
        return RetrieveOutput(
            retrieved=[_post("a"), _post("b")],
        )

    async def judge_relevance(state: ChatState) -> JudgeOutput:
        return JudgeOutput(
            judge=RelevanceVerdict(relevant=False, score=0.2, reason="vague match")
        )

    async def rewrite_query(state: ChatState) -> RewriteQueryOutput:
        return RewriteQueryOutput(rewritten_query="langgraph state reducers")

    async def retrieve_round_2(state: ChatState) -> RetrieveOutput:
        # Round two re-finds b and discovers c; b must not duplicate.
        return RetrieveOutput(retrieved=[_post("b"), _post("c")])

    async def record_tool_call(state: ChatState) -> ToolLoopOutput:
        return ToolLoopOutput(
            tool_calls=[
                ToolCall(name="search_posts", arguments='{"query": "q"}', result="[]")
            ],
            messages=[ChatMessage(role="user", content="first question")],
        )

    async def answer_first_half(state: ChatState) -> AnswerOutput:
        return AnswerOutput(answer="hello ")

    async def answer_second_half(state: ChatState) -> AnswerOutput:
        return AnswerOutput(answer="world")

    builder = StateGraph(ChatState)
    builder.add_node("retrieve_round_1", retrieve_round_1)
    builder.add_node("judge_relevance", judge_relevance)
    builder.add_node("rewrite_query", rewrite_query)
    builder.add_node("retrieve_round_2", retrieve_round_2)
    builder.add_node("record_tool_call", record_tool_call)
    builder.add_node("answer_first_half", answer_first_half)
    builder.add_node("answer_second_half", answer_second_half)
    builder.add_edge(START, "retrieve_round_1")
    builder.add_edge("retrieve_round_1", "judge_relevance")
    builder.add_edge("judge_relevance", "rewrite_query")
    builder.add_edge("rewrite_query", "retrieve_round_2")
    builder.add_edge("retrieve_round_2", "record_tool_call")
    builder.add_edge("record_tool_call", "answer_first_half")
    builder.add_edge("answer_first_half", "answer_second_half")
    builder.add_edge("answer_second_half", END)
    graph = builder.compile()

    result = await graph.ainvoke({"query": "how do reducers work?", "thread_id": ""})

    # Accumulating channels compose across hops...
    assert [post.post_id for post in result["retrieved"]] == ["a", "b", "c"]
    assert result["messages"] == [ChatMessage(role="user", content="first question")]
    assert len(result["tool_calls"]) == 1
    assert result["answer"] == "hello world"
    # ...while single-writer channels keep the latest value.
    assert result["query"] == "how do reducers work?"
    assert result["thread_id"] == ""
    assert result["rewritten_query"] == "langgraph state reducers"
    assert result["judge"] == RelevanceVerdict(
        relevant=False, score=0.2, reason="vague match"
    )
    assert "cited_post_ids" not in result
