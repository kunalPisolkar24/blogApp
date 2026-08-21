"""Assembly of the grounded chat graph."""

from langgraph.graph import END, START, StateGraph

from src.embeddings import EmbeddingProvider
from src.graphs.nodes import (
    make_judge_relevance,
    make_retrieve,
    make_rewrite_query,
    route_after_judge,
)
from src.graphs.state import ChatState
from src.llm import LLMProvider
from src.vector import SearchStore


def build_chat_graph(
    llm: LLMProvider, search: SearchStore, embeddings: EmbeddingProvider
):
    """Compile the grounded chat graph.

    rewrite → retrieve → judge, looping back through a fresh rewrite on
    a failing relevance verdict until the retrieval budget is spent.
    The router's done-target is END for now; the answer node lands with
    tool calling and streaming (#153/#156) and takes over that target,
    after which #155 compiles this graph with the checkpointer.
    """
    builder = StateGraph(ChatState)
    builder.add_node("rewrite_query", make_rewrite_query(llm))
    builder.add_node("retrieve", make_retrieve(search, embeddings))
    builder.add_node("judge_relevance", make_judge_relevance(llm))
    builder.add_edge(START, "rewrite_query")
    builder.add_edge("rewrite_query", "retrieve")
    builder.add_edge("retrieve", "judge_relevance")
    builder.add_conditional_edges(
        "judge_relevance",
        route_after_judge,
        {"rewrite_query": "rewrite_query", "answer": END},
    )
    return builder.compile()
