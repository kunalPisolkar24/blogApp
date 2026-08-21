"""Plain async node functions for the chat graph."""

import json
import logging
import re

from langsmith import traceable

from src.config import settings
from src.domain.prompts import (
    JUDGE_RELEVANCE_PROMPT,
    REWRITE_QUERY_PROMPT,
    judge_user_prompt,
    rewrite_query_user_prompt,
)
from src.embeddings import EmbeddingProvider
from src.graphs.state import (
    ChatState,
    JudgeOutput,
    RelevanceVerdict,
    RetrieveOutput,
    RewriteQueryOutput,
)
from src.llm import LLMError, LLMProvider
from src.observability import metrics
from src.vector import RetrievedPost, SearchStore

logger = logging.getLogger(__name__)


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


def _cap_bodies(posts: list[RetrievedPost]) -> list[RetrievedPost]:
    """Split the shared context budget evenly across retrieved posts."""
    budget = settings.CHAT_MAX_CONTEXT_CHARS
    per_post = budget // len(posts) if posts else budget
    return [
        RetrievedPost(post_id=post.post_id, title=post.title, body=post.body[:per_post])
        for post in posts
    ]


def make_retrieve(search: SearchStore, embeddings: EmbeddingProvider):
    """Build the ``retrieve`` node bound to the search and embedding providers."""

    @traceable(run_type="chain")
    async def retrieve(state: ChatState) -> RetrieveOutput:
        """Embed the (rewritten) query and fetch grounding posts.

        Uses the rewrite when one exists; failures propagate because a
        turn without any grounding attempt is not worth continuing.
        """
        query = state.get("rewritten_query") or state["query"]
        top_k = state.get("top_k") or settings.CHAT_TOP_K_DEFAULT

        vector = (await embeddings.embed([query]))[0]
        posts = await search.retrieve_by_vector(vector, top_k)

        return RetrieveOutput(
            retrieved=_cap_bodies(posts),
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
