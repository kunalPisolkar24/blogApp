"""Unit tests for the feed agent graph and blend executor."""

from types import SimpleNamespace

import pytest
from prometheus_client.registry import REGISTRY

from src.graphs.feed_graph import (
    BALANCED,
    EXPLORER,
    FRESH,
    FeedAgent,
    _interleave,
    _normalize_preset,
    execute_blend,
    profile_summary,
)
from src.llm import LLMError
from tests.fake_llm import FakeLLM


def _decisions(outcome: str) -> float:
    return (
        REGISTRY.get_sample_value("feed_agent_decisions_total", {"outcome": outcome})
        or 0.0
    )


class StubSearch:
    """Profile-only store double: records recommend kwargs per call."""

    def __init__(self):
        self.calls: list[dict] = []

    async def user_tag_weights(self, user_id: str) -> dict[str, float]:
        return {"golang": 5.0}

    async def recommend(self, user_id, offset, limit, recency_days=None):
        self.calls.append({"method": "recommend", "recency_days": recency_days})
        return SimpleNamespace(post_ids=["b1", "b2"], total=2)

    async def recommend_surprise(self, user_id, offset, limit, seed):
        self.calls.append({"method": "surprise"})
        return SimpleNamespace(post_ids=["s1", "s2"], total=2)


async def test_agent_picks_the_scripted_preset() -> None:
    agent = FeedAgent(FakeLLM(response="explorer"), StubSearch())

    assert await agent.decide("user-1") == EXPLORER


async def test_agent_falls_back_to_balanced_on_llm_error() -> None:
    fallbacks_before = _decisions("fallback")
    agent = FeedAgent(FakeLLM(error=LLMError("down")), StubSearch())

    assert await agent.decide("user-1") == BALANCED
    assert _decisions("fallback") == fallbacks_before + 1


@pytest.mark.parametrize(
    ("answer", "expected"),
    [
        ("explorer", EXPLORER),
        ("FRESH.", FRESH),
        ('"balanced"', BALANCED),
        ("surprise", None),
        ("", None),
    ],
)
def test_normalize_preset_accepts_only_known_presets(answer, expected) -> None:
    assert _normalize_preset(answer) == expected


async def test_agent_caches_the_decision_within_ttl() -> None:
    llm = FakeLLM(response="fresh")
    agent = FeedAgent(llm, StubSearch())

    first = await agent.decide("user-1")
    second = await agent.decide("user-1")

    assert first == second == FRESH
    assert len(llm.calls) == 1, "the second decision must be a cache hit"


async def test_execute_blend_fresh_narrows_the_recency_window() -> None:
    search = StubSearch()

    await execute_blend(search, "u", 0, 10, preset=FRESH)

    assert search.calls == [{"method": "recommend", "recency_days": 14}]


async def test_execute_blend_explorer_interleaves_surprise_pages() -> None:
    search = StubSearch()

    result = await execute_blend(search, "u", 0, 6, preset=EXPLORER, seed=7)

    methods = [call["method"] for call in search.calls]
    assert methods.count("surprise") == 1, "one surprise page feeds the blend"
    assert {"b1", "b2"} <= set(result.post_ids), "base picks survive"
    assert {"s1", "s2"} & set(result.post_ids), "surprise picks make the page"


def test_interleave_places_spice_every_third_slot() -> None:
    assert _interleave(["b1", "b2", "b3", "b4"], ["s1"]) == [
        "b1",
        "b2",
        "s1",
        "b3",
        "b4",
    ]


def test_interleave_survives_a_short_base() -> None:
    assert _interleave(["b1"], ["s1", "s2"]) == ["b1", "s1", "s2"]


def test_profile_summary_lists_top_interests() -> None:
    summary = profile_summary({"golang": 5.0}, seen_count=3)

    assert "3 posts interacted" in summary
    assert "golang (5)" in summary


def test_profile_summary_handles_cold_start() -> None:
    assert profile_summary({}, seen_count=0) == "no interactions recorded yet"
