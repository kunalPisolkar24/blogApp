"""Feed agent (Layer 2): picks a blend preset for a user's feed.

The decision is a single LLM call over a compact taste-profile summary,
cached per user for ``AGENT_DECISION_TTL_SECONDS``. Any failure — an
LLM error or an unparsable answer — falls back to the balanced preset.
Execution stays deterministic: :func:`execute_blend` composes the same
engine paths the RPC has always used, so ``AGENT_MODE=deterministic``
remains byte-for-byte today's behavior.
"""

import time
from collections.abc import Awaitable, Callable
from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from langsmith import traceable

from src.config import settings
from src.domain.prompts import FEED_AGENT_PROMPT, feed_agent_user_prompt
from src.llm import LLMError, LLMProvider
from src.observability import metrics
from src.vector import SearchResult, SearchStore

BALANCED = "balanced"
FRESH = "fresh"
EXPLORER = "explorer"
PRESETS = (BALANCED, FRESH, EXPLORER)


def _normalize_preset(answer: str) -> str | None:
    """Reduce an LLM answer to a preset name, or None if unusable."""
    word = answer.strip().lower().strip(".,!\"'")
    return word if word in PRESETS else None


def profile_summary(tag_weights: dict[str, float], seen_count: int) -> str:
    """Render the taste facts the decision is based on."""
    if not tag_weights:
        return "no interactions recorded yet"
    top_tags = sorted(tag_weights.items(), key=lambda item: item[1], reverse=True)
    listed = ", ".join(f"{tag} ({weight:g})" for tag, weight in top_tags[:8])
    return f"{seen_count} posts interacted with; interests: {listed}"


async def execute_blend(
    search: SearchStore,
    user_id: str,
    offset: int,
    limit: int,
    preset: str = BALANCED,
    seed: int = 0,
) -> SearchResult:
    """Serve one feed page for a preset using the deterministic engine.

    - fresh: default ranking inside a short recency window
    - explorer: default ranking interleaved with surprise pages
    - balanced: the standard default path
    """
    if preset == FRESH:
        return await search.recommend(
            user_id,
            offset,
            limit,
            recency_days=settings.FEED_FRESH_RECENCY_DAYS,
        )
    if preset == EXPLORER:
        need = offset + limit
        base = await search.recommend(user_id, 0, need + limit)
        spice_count = max(1, round(need * settings.FEED_EXPLORER_SURPRISE_RATIO))
        spice = await search.recommend_surprise(user_id, 0, spice_count, seed)
        blended = _interleave(base.post_ids, spice.post_ids)
        return SearchResult(
            post_ids=blended[offset : offset + limit], total=len(blended)
        )
    return await search.recommend(user_id, offset, limit)


def _interleave(base: list[str], spice: list[str]) -> list[str]:
    """Blend two rankings, keeping roughly one surprise in three slots.

    Deterministic walk: every third slot comes from the surprise list,
    everything else keeps the base order; duplicates are dropped.
    """
    out: list[str] = []
    base_index = spice_index = 0
    while base_index < len(base) or spice_index < len(spice):
        take_spice = spice_index < len(spice) and (
            len(out) % 3 == 2 or base_index >= len(base)
        )
        if take_spice:
            candidate = spice[spice_index]
            spice_index += 1
        else:
            candidate = base[base_index]
            base_index += 1
        if candidate not in out:
            out.append(candidate)
    return out


class FeedState(TypedDict):
    user_id: str
    summary: str
    preset: str


def make_fetch_profile(search: SearchStore) -> Callable[[FeedState], Awaitable[dict]]:
    async def fetch_profile(state: FeedState) -> dict:
        tag_weights = await search.user_tag_weights(state["user_id"])
        return {"summary": profile_summary(tag_weights, seen_count=len(tag_weights))}

    return fetch_profile


def make_decide_preset(llm: LLMProvider) -> Callable[[FeedState], Awaitable[dict]]:
    @traceable(run_type="chain")
    async def decide_preset(state: FeedState) -> dict:
        try:
            answer = await llm.generate_completion(
                FEED_AGENT_PROMPT, feed_agent_user_prompt(state["summary"])
            )
            preset = _normalize_preset(answer)
        except LLMError:
            preset = None
        if preset is None:
            metrics.FEED_AGENT_DECISIONS.labels(outcome="fallback").inc()
            return {"preset": BALANCED}
        metrics.FEED_AGENT_DECISIONS.labels(outcome="miss").inc()
        return {"preset": preset}

    return decide_preset


class FeedAgent:
    """Compiled decision graph plus the per-user decision cache."""

    def __init__(self, llm: LLMProvider, search: SearchStore) -> None:
        self._search = search
        builder = StateGraph(FeedState)
        builder.add_node("fetch_profile", make_fetch_profile(search))
        builder.add_node("decide_preset", make_decide_preset(llm))
        builder.add_edge(START, "fetch_profile")
        builder.add_edge("fetch_profile", "decide_preset")
        builder.add_edge("decide_preset", END)
        self._graph = builder.compile()
        self._decisions: dict[str, tuple[str, float]] = {}

    async def decide(self, user_id: str) -> str:
        """The blend preset for this user, cached within the TTL."""
        now = time.monotonic()
        cached = self._decisions.get(user_id)
        if cached is not None and cached[1] > now:
            metrics.FEED_AGENT_DECISIONS.labels(outcome="hit").inc()
            return cached[0]

        result = await self._graph.ainvoke({"user_id": user_id})
        preset = result["preset"]
        expires = now + settings.AGENT_DECISION_TTL_SECONDS
        self._decisions[user_id] = (preset, expires)
        return preset
