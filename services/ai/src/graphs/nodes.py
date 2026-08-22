"""Plain async node functions for the chat graph."""

import json
import logging
import re

from langgraph.config import get_stream_writer
from langsmith import traceable

from src.config import settings
from src.domain.prompts import (
    CHAT_SYSTEM_PROMPT,
    HISTORY_SUMMARY_PROMPT,
    JUDGE_RELEVANCE_PROMPT,
    REWRITE_QUERY_PROMPT,
    chat_user_prompt,
    history_summary_user_prompt,
    judge_user_prompt,
    rewrite_query_user_prompt,
)
from src.embeddings import EmbeddingProvider
from src.graphs.retrieval import (
    DenseSource,
    HybridSource,
    RetrievalSource,
    fan_out,
    fuse_context,
)
from src.graphs.state import (
    AnswerOutput,
    ChatMessage,
    ChatState,
    JudgeOutput,
    MessageReplacement,
    RelevanceVerdict,
    RetrievedReplacement,
    RetrieveOutput,
    RewriteQueryOutput,
    ToolCall,
    ToolLoopOutput,
)
from src.graphs.tools import (
    TOOL_AGENT_PROMPT,
    TOOL_SCHEMAS,
    ToolHandler,
    format_tool_error,
)
from src.llm import LLMError, LLMProvider
from src.observability import metrics
from src.vector import RetrievedPost, SearchStore

logger = logging.getLogger(__name__)


async def start_turn(state: ChatState) -> dict:
    """Open the turn by joining the user's question into the persisted
    conversation history; later turns resume from it via thread_id.

    Per-turn scratch (grounding context) resets here so sessions never
    cite stale posts from earlier questions."""
    return {
        "messages": [ChatMessage(role="user", content=state["query"])],
        "retrieved": RetrievedReplacement([]),
    }


def make_rewrite_query(llm: LLMProvider):
    """Build the ``rewrite_query`` node bound to an LLM provider."""

    @traceable(run_type="chain")
    async def rewrite_query(state: ChatState) -> RewriteQueryOutput:
        """Turn the raw question into a searchable standalone query.

        Recent turns give follow-up questions their context ("what about
        its pricing?"). Falls back to the original query when the rewrite
        comes back empty or the call fails, so retrieval always has
        something to run on.
        """
        query = state["query"]
        history = [
            (message.role, message.content) for message in state.get("messages", [])
        ][-settings.CHAT_MAX_HISTORY_TURNS :]

        try:
            rewritten = await llm.generate_completion(
                REWRITE_QUERY_PROMPT,
                rewrite_query_user_prompt(query, history),
            )
        except LLMError as exc:
            logger.warning("query rewrite failed, keeping original: %s", exc)
            metrics.QUERY_REWRITES.labels(outcome="kept_original").inc()
            return RewriteQueryOutput(rewritten_query=query)

        rewritten = rewritten.strip()
        if not rewritten:
            metrics.QUERY_REWRITES.labels(outcome="kept_original").inc()
            return RewriteQueryOutput(rewritten_query=query)

        metrics.QUERY_REWRITES.labels(outcome="rewritten").inc()
        return RewriteQueryOutput(rewritten_query=rewritten)

    return rewrite_query


def make_retrieve(search: SearchStore, embeddings: EmbeddingProvider):
    """Build the ``retrieve`` node bound to the search and embedding providers.

    Grounding fans out over a dense and a hybrid source in parallel; #154
    adds a full-post-body source through the reserved ``body_fetcher``
    slot once the content-service bridge exists.
    """
    sources: list[RetrievalSource] = [
        DenseSource(search, embeddings),
        HybridSource(search),
    ]

    @traceable(run_type="chain")
    async def retrieve(state: ChatState) -> RetrieveOutput:
        """Fetch grounding posts from every source and fuse them.

        Uses the rewrite when one exists. Source failures degrade to the
        remaining sources inside the fan-out; a total retrieval failure
        propagates because a turn without any grounding attempt is not
        worth continuing.
        """
        query = state.get("rewritten_query") or state["query"]
        top_k = state.get("top_k") or settings.CHAT_TOP_K_DEFAULT

        fetched = await fan_out(sources, query, top_k)
        rankings = [(source.weight, posts) for source, posts in fetched]

        return RetrieveOutput(
            retrieved=fuse_context(rankings),
            retrieval_rounds=state.get("retrieval_rounds", 0) + 1,
        )

    return retrieve


def _parse_verdict(raw: str) -> RelevanceVerdict | None:
    """Parse the judge's JSON reply; None when it is not usable."""
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    payload = match.group(0) if match else raw
    try:
        data = json.loads(payload)
        return RelevanceVerdict(
            relevant=bool(data["relevant"]),
            score=round(float(data["score"]), 4),
        )
    except (ValueError, KeyError, TypeError):
        return None


def make_judge_relevance(llm: LLMProvider):
    """Build the ``judge_relevance`` node bound to an LLM provider."""

    @traceable(run_type="chain")
    async def judge_relevance(state: ChatState) -> JudgeOutput:
        """Decide whether the retrieved excerpts answer the question.

        A failed or unparseable verdict falls open (proceed as relevant):
        retrieval already applies a dense score threshold, and an unusable
        verdict should not burn the remaining rewrite budget on what would
        be an identical second opinion.
        """
        query = state["query"]
        contexts = [(post.title, post.body) for post in state.get("retrieved", [])]

        verdict = None
        try:
            raw = await llm.generate_completion(
                JUDGE_RELEVANCE_PROMPT,
                judge_user_prompt(query, contexts),
            )
            verdict = _parse_verdict(raw)
        except LLMError as exc:
            logger.warning("relevance judge unavailable: %s", exc)
        if verdict is None:
            verdict = RelevanceVerdict(
                relevant=True,
                reason="judge unavailable or unparseable; proceeding",
            )

        logger.info(
            "retrieval judged",
            extra={
                "relevant": verdict.relevant,
                "score": verdict.score,
                "reason": verdict.reason,
                "rounds": state.get("retrieval_rounds", 0),
            },
        )
        return JudgeOutput(judge=verdict)

    return judge_relevance


def route_after_judge(state: ChatState) -> str:
    """Send a failing verdict back through another rewrite until the
    retrieval budget is spent, then move on with whatever we have."""
    rounds = state.get("retrieval_rounds", 0)
    judge = state.get("judge")
    if (judge is None or not judge.relevant) and rounds < (
        settings.CHAT_MAX_RETRIEVAL_ROUNDS
    ):
        return "rewrite_query"
    return "answer"


def make_tool_loop(llm: LLMProvider, registry: dict[str, ToolHandler]):
    """Build the ``tool_loop`` node bound to an LLM provider and tools."""

    @traceable(run_type="chain")
    async def tool_loop(state: ChatState) -> ToolLoopOutput:
        """Let the model request grounded lookups before the answer phase.

        The agent transcript lives only inside this node: state keeps the
        executed ``ToolCall`` records (which the answer prompt reads) but
        not the tool wire format, so conversation compaction never sees
        tool protocol messages.
        """
        context = "\n\n".join(
            f"[{index}] {post.post_id}: {post.title}\n{post.body}"
            for index, post in enumerate(state.get("retrieved", []), start=1)
        )
        user_content = f"Question: {state['query']}"
        if context:
            user_content += f"\n\nRetrieved posts:\n{context}"
        transcript: list[dict] = [
            {"role": "system", "content": TOOL_AGENT_PROMPT},
            {"role": "user", "content": user_content},
        ]

        executed: list[ToolCall] = []
        while len(executed) < settings.CHAT_MAX_TOOL_CALLS:
            reply = await llm.generate_tool_completion(transcript, TOOL_SCHEMAS)
            if not reply.tool_requests:
                break

            transcript.append(
                {
                    "role": "assistant",
                    "content": reply.content or "",
                    "tool_calls": [
                        {
                            "id": request.id,
                            "type": "function",
                            "function": {
                                "name": request.name,
                                "arguments": request.arguments,
                            },
                        }
                        for request in reply.tool_requests
                    ],
                }
            )
            for request in reply.tool_requests:
                result = await _execute(registry, request)
                transcript.append(
                    {
                        "role": "tool",
                        "tool_call_id": request.id,
                        "content": result,
                    }
                )
                executed.append(
                    ToolCall(
                        name=request.name,
                        arguments=request.arguments,
                        result=result,
                    )
                )

        return ToolLoopOutput(tool_calls=executed)

    return tool_loop


async def _execute(registry: dict[str, ToolHandler], request) -> str:
    """Run one tool request; failures become results the model can read."""
    handler = registry.get(request.name)
    if handler is None:
        return format_tool_error(request.name, "unknown tool")

    try:
        arguments = json.loads(request.arguments or "{}")
        if not isinstance(arguments, dict):
            raise TypeError("arguments must be a JSON object")
        return await handler(**arguments)
    except (ValueError, TypeError):
        return format_tool_error(request.name, "bad arguments")
    except Exception as exc:  # noqa: BLE001 - a broken tool must not fail the turn
        logger.warning("tool %s failed: %s", request.name, exc)
        return format_tool_error(request.name, str(exc))


_CITATION_RE = re.compile(r"\[(\d+)\]")


def cited_post_ids(answer: str, posts: list[RetrievedPost]) -> list[str]:
    """Map the [n] markers in an answer back to the retrieved post ids.

    Markers outside the retrieved range are ignored. When the answer
    cites nothing, every retrieved post is cited so the client can still
    surface the sources it was grounded in.
    """
    cited: list[str] = []
    for match in _CITATION_RE.finditer(answer):
        index = int(match.group(1)) - 1
        if 0 <= index < len(posts):
            post_id = posts[index].post_id
            if post_id not in cited:
                cited.append(post_id)
    if not cited:
        cited = [post.post_id for post in posts]
    return cited


def make_answer(llm: LLMProvider):
    """Build the ``answer`` node bound to an LLM provider."""

    @traceable(run_type="chain")
    async def answer(state: ChatState) -> AnswerOutput:
        """Generate the grounded answer, streaming deltas out of the graph.

        History is every persisted turn before this one; the current
        question was appended by ``start_turn``. Deltas reach the RPC
        layer through the custom stream writer while the full text is
        recorded as an assistant turn and cited ids resolve against the
        fused retrieval context.
        """
        query = state["query"]
        messages = state.get("messages", [])
        history = [(message.role, message.content) for message in messages[:-1]][
            -settings.CHAT_MAX_HISTORY_TURNS :
        ]
        contexts = state.get("retrieved", [])

        writer = get_stream_writer()
        parts: list[str] = []
        async for delta in llm.generate_stream(
            CHAT_SYSTEM_PROMPT,
            chat_user_prompt(
                query, history, [(post.title, post.body) for post in contexts]
            ),
        ):
            parts.append(delta)
            writer(delta)

        answer_text = "".join(parts)
        cited = cited_post_ids(answer_text, contexts)
        logger.info(
            "chat answered",
            extra={
                "completion_chars": len(answer_text),
                "contexts": len(contexts),
                "cited_posts": len(cited),
            },
        )
        writer({"cited_post_ids": cited})

        return AnswerOutput(
            answer=answer_text,
            messages=[ChatMessage(role="assistant", content=answer_text)],
            cited_post_ids=cited,
        )

    return answer


def make_compact_history(llm: LLMProvider):
    """Build the ``compact_history`` node bound to an LLM provider."""

    @traceable(run_type="chain")
    async def compact_history(state: ChatState) -> dict:
        """Fold older turns into a rolling summary turn.

        Runs every turn but acts only once the conversation outgrows
        CHAT_MAX_HISTORY_TURNS: everything older than the kept window is
        summarized (re-summarizing any earlier summary so no information
        is lost across compactions) and replaces those turns in state.
        A failed or empty summary skips compaction — history is kept
        intact rather than truncated blind.
        """
        messages = state.get("messages", [])
        keep = settings.CHAT_MAX_HISTORY_TURNS
        if len(messages) <= keep:
            return {}

        folded, tail = messages[:-keep], list(messages[-keep:])
        prior_summary = "\n".join(
            message.content for message in folded if message.role == "summary"
        )
        turns = [(message.role, message.content) for message in folded]

        try:
            summary = await llm.generate_completion(
                HISTORY_SUMMARY_PROMPT,
                history_summary_user_prompt(prior_summary, turns),
            )
        except LLMError as exc:
            logger.warning("history compaction failed, keeping turns: %s", exc)
            return {}

        summary = summary.strip()
        if not summary:
            logger.warning("history compaction produced nothing; keeping turns")
            return {}

        metrics.CHAT_COMPACTS.inc()
        return {
            "messages": MessageReplacement(
                [ChatMessage(role="summary", content=summary)] + tail
            )
        }

    return compact_history
