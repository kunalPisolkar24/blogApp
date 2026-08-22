"""State schema for the chat graph.

The graph runs on a single TypedDict whose fields either accumulate
(messages, retrieved contexts, streamed answer chunks, tool calls) or
hold the latest value written by their one producing node. Reducers
keep loop iterations composing instead of overwriting each other.
"""

from dataclasses import dataclass
from operator import add
from typing import Annotated, TypedDict

from src.vector import RetrievedPost


@dataclass(frozen=True)
class ChatMessage:
    """One conversation turn, as stored in state and checkpoints."""

    role: str  # "user" or "assistant"
    content: str


@dataclass(frozen=True)
class RelevanceVerdict:
    """The judge node's verdict on whether retrieval answers the query."""

    relevant: bool
    score: float | None = None
    reason: str = ""


@dataclass(frozen=True)
class ToolCall:
    """One agent tool invocation and its result."""

    name: str
    arguments: str  # JSON arguments sent to the tool
    result: str  # result excerpt fed back to the model


def merge_retrieved(
    current: list[RetrievedPost], incoming: list[RetrievedPost]
) -> list[RetrievedPost]:
    """Accumulate retrieved posts across rewrite-loop iterations,
    keeping the first occurrence of every post id."""
    seen = {post.post_id for post in current}
    return current + [post for post in incoming if post.post_id not in seen]


class ChatState(TypedDict):
    """Everything one chat turn carries between nodes."""

    # Request entry points; thread_id empty means the legacy stateless path.
    query: str
    thread_id: str
    top_k: int

    # How many retrieval rounds have run for this turn; the conditional
    # edge after the judge reads it to enforce the rewrite budget.
    retrieval_rounds: int

    # Conversation history; accumulates across turns (and compaction rewrites it).
    messages: Annotated[list[ChatMessage], add]

    # Searchable form of the query; last rewrite wins.
    rewritten_query: str

    # Grounding context; accumulates across retrieval rounds without duplicates.
    retrieved: Annotated[list[RetrievedPost], merge_retrieved]

    # The judge node's verdict on the current retrieval round.
    judge: RelevanceVerdict

    # Agent tool invocations; accumulate up to the tool loop's cap.
    tool_calls: Annotated[list[ToolCall], add]

    # Streamed answer deltas concatenate into the full response text.
    answer: Annotated[str, add]

    # Post ids cited by the final answer; computed once at the end.
    cited_post_ids: list[str]


class RewriteQueryOutput(TypedDict):
    rewritten_query: str


class RetrieveOutput(TypedDict):
    retrieved: list[RetrievedPost]


class JudgeOutput(TypedDict):
    judge: RelevanceVerdict


class ToolLoopOutput(TypedDict):
    tool_calls: list[ToolCall]


class AnswerOutput(TypedDict):
    answer: str
    messages: list[ChatMessage]
    cited_post_ids: list[str]
