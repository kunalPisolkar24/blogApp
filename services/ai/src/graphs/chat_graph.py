"""Assembly of the grounded chat graph."""

from langgraph.config import RunnableConfig
from langgraph.graph import END, START, StateGraph

from src.embeddings import EmbeddingProvider
from src.graphs.nodes import (
    make_judge_relevance,
    make_retrieve,
    make_rewrite_query,
    make_tool_loop,
    route_after_judge,
    start_turn,
)
from src.graphs.state import ChatState
from src.graphs.tools import make_tool_registry
from src.llm import LLMProvider
from src.vector import SearchStore


def build_chat_graph(
    llm: LLMProvider,
    search: SearchStore,
    embeddings: EmbeddingProvider,
    post_fetcher=None,
    checkpointer=None,
):
    """Compile the grounded chat graph.

    rewrite → retrieve → judge, looping back through a fresh rewrite on
    a failing relevance verdict until the retrieval budget is spent; a
    passing (or spent) verdict hands off to the tool loop, where the
    model may request further lookups. ``post_fetcher`` upgrades the
    get_post_body tool from its placeholder to real full bodies. The
    streaming answer node lands with #156 and takes over the tool loop's
    END edge, after which #155 compiles this graph with the checkpointer.
    """
    builder = StateGraph(ChatState)
    builder.add_node("start_turn", start_turn)
    builder.add_node("rewrite_query", make_rewrite_query(llm))
    builder.add_node("retrieve", make_retrieve(search, embeddings))
    builder.add_node("judge_relevance", make_judge_relevance(llm))
    builder.add_node(
        "tool_loop",
        make_tool_loop(
            llm,
            make_tool_registry(
                search,
                body_fetcher=post_fetcher.fetch_body if post_fetcher else None,
            ),
        ),
    )
    builder.add_edge(START, "start_turn")
    builder.add_edge("start_turn", "rewrite_query")
    builder.add_edge("rewrite_query", "retrieve")
    builder.add_edge("retrieve", "judge_relevance")
    builder.add_conditional_edges(
        "judge_relevance",
        route_after_judge,
        {"rewrite_query": "rewrite_query", "answer": "tool_loop"},
    )
    builder.add_edge("tool_loop", END)
    return builder.compile(checkpointer=checkpointer)


def graph_config_for(thread_id: str) -> RunnableConfig | None:
    """Config resuming a checkpointed session for the thread.

    An empty thread id keeps the run stateless: callers use a graph
    compiled without a checkpointer and pass no config.
    """
    if not thread_id:
        return None
    return {"configurable": {"thread_id": thread_id}}
