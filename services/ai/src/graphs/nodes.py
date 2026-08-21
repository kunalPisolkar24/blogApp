"""Plain async node functions for the chat graph."""

import logging

from langsmith import traceable

from src.config import settings
from src.domain.prompts import REWRITE_QUERY_PROMPT, rewrite_query_user_prompt
from src.graphs.state import ChatState, RewriteQueryOutput
from src.llm import LLMError, LLMProvider
from src.observability import metrics

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
