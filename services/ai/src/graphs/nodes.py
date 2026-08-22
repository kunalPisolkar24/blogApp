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
from src.graphs.retrieval import (
    DenseSource,
    HybridSource,
    RetrievalSource,
    fan_out,
    fuse_context,
)
from src.graphs.state import (
    ChatState,
    JudgeOutput,
    RelevanceVerdict,
    RetrieveOutput,
    RewriteQueryOutput,
)
from src.llm import LLMError, LLMProvider
from src.observability import metrics
from src.vector import SearchStore

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
