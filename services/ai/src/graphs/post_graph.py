"""Human-in-the-loop post generation graph.

``generate_draft`` produces the post payload once; the ``review`` node
then pauses the whole workflow at an ``interrupt()`` until a reviewer
resumes it with ``Command(resume=...)``. Because the pause is a
checkpoint, the workflow survives restarts and the review node is never
re-executed against a stale payload.

State uses only plain strings/lists so checkpoints round-trip through
the shared serde without extra registrations. Rejection is a pure state
update: it keeps the thread paused at ``review``, which lets a reviewer
change their mind and approve later.
"""

from typing import Any

from langgraph.config import RunnableConfig
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from typing_extensions import TypedDict

from src.domain.models import GeneratedPost
from src.domain.prompts import POST_PROMPT, post_user_prompt
from src.domain.sanitize import sanitize_post_html
from src.domain.text import extract_json
from src.llm import LLMProvider

DRAFT_THREAD_PREFIX = "post-draft:"

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"

DECISION_APPROVED = "approved"
DECISION_REJECTED = "rejected"


def draft_thread_id(approval_id: str) -> str:
    """Namespace draft threads so they never collide with chat sessions."""
    return f"{DRAFT_THREAD_PREFIX}{approval_id}"


def post_graph_config_for(approval_id: str) -> RunnableConfig:
    return {"configurable": {"thread_id": draft_thread_id(approval_id)}}


class PostWorkflowState(TypedDict):
    prompt: str
    title: str
    body: str
    summary: str
    tags: list[str]
    # decision recorded when a reviewer resumes the workflow.
    decision: str
    # pending until a resume lands; rejected stays resumable.
    status: str
    # optional reviewer-facing note attached by RejectPost.
    reason: str


def make_generate_draft(llm: LLMProvider):
    async def generate_draft(state: PostWorkflowState) -> dict:
        raw = await llm.generate_completion(
            POST_PROMPT, post_user_prompt(state["prompt"])
        )
        post = GeneratedPost.model_validate_json(extract_json(raw))
        return {
            "title": post.title,
            "body": sanitize_post_html(post.body),
            "summary": post.summary,
            "tags": list(post.tags),
            "status": STATUS_PENDING,
        }

    return generate_draft


def make_review():
    def review(state: PostWorkflowState) -> dict:
        decision = interrupt("awaiting approval decision")
        if decision == DECISION_REJECTED:
            return {"decision": DECISION_REJECTED, "status": STATUS_REJECTED}
        return {"decision": DECISION_APPROVED, "status": STATUS_APPROVED}

    return review


def build_post_generation_graph(llm: LLMProvider, checkpointer=None):
    """Compile the draft graph: generate → review (interrupt) → END."""
    builder = StateGraph(PostWorkflowState)
    builder.add_node("generate_draft", make_generate_draft(llm))
    builder.add_node("review", make_review())
    builder.add_edge(START, "generate_draft")
    builder.add_edge("generate_draft", "review")
    builder.add_edge("review", END)
    return builder.compile(checkpointer=checkpointer)


def draft_edits_patch(
    title: str | None,
    body: str | None,
    summary: str | None,
    tags: list[str] | None,
) -> dict[str, Any]:
    """Keep only the fields a reviewer actually changed."""
    patch: dict[str, Any] = {}
    if title is not None:
        patch["title"] = title
    if body is not None:
        patch["body"] = body
    if summary is not None:
        patch["summary"] = summary
    if tags:
        patch["tags"] = list(tags)
    return patch


async def resume_with_decision(
    graph, config: RunnableConfig, decision: str, edits: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Apply optional state edits, then resume the paused review."""
    if edits:
        await graph.aupdate_state(config, edits)
    result = await graph.ainvoke(Command(resume=decision), config=config)
    return {key: value for key, value in result.items() if not key.startswith("__")}
