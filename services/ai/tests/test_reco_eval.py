"""Offline checks for the recommender eval dataset and metric math.

These run without Docker or a live service: they guard the metric functions
used by ``scripts/eval_reco.py`` and the dataset's shape (valid ids,
disjoint train/held-out splits, sane user definitions).
"""

from __future__ import annotations

import re

from scripts.eval_reco import (
    precision_at_k,
    print_comparison,
    relevant_ids,
    seen_ratio,
    tag_diversity,
)
from scripts.reco_eval_data import CORPUS, POST_BY_ID, USERS

HEX24 = re.compile(r"^[0-9a-f]{24}$")


# --- Metric math ---


def test_precision_at_k_counts_relevant_hits() -> None:
    recommended = ["a", "b", "c", "d"]
    assert precision_at_k(recommended, {"a", "c"}, k=4) == 0.5
    assert precision_at_k(recommended, {"a", "b", "c", "d"}, k=4) == 1.0
    assert precision_at_k(recommended, set(), k=4) == 0.0


def test_precision_at_k_truncates_to_k() -> None:
    recommended = ["a", "b", "z"]
    # Only the first two slots count at k=2.
    assert precision_at_k(recommended, {"a", "z"}, k=2) == 0.5
    assert precision_at_k(recommended, {"a", "z"}, k=3) == 2 / 3


def test_precision_at_k_handles_empty_feed() -> None:
    assert precision_at_k([], {"a"}, k=5) == 0.0


def test_tag_diversity_spread() -> None:
    tags = {"a": ["t1", "t2"], "b": ["t1", "t3"]}
    # Four tag occurrences, three distinct.
    assert tag_diversity(["a", "b"], tags) == 0.75
    # All-distinct tags score a perfect spread.
    assert tag_diversity(["a"], {"a": ["x", "y"]}) == 1.0
    # Every occurrence identical bottoms out at one distinct over total.
    assert tag_diversity(["a", "b"], {"a": ["t1"], "b": ["t1"]}) == 0.5


def test_tag_diversity_handles_unknown_and_empty() -> None:
    assert tag_diversity(["missing"], {}) == 0.0
    assert tag_diversity([], {"a": ["t1"]}) == 0.0


def test_seen_ratio_counts_overlap() -> None:
    assert seen_ratio(["a", "b", "c"], {"a"}) == 1 / 3
    assert seen_ratio(["a", "b"], {"a", "b"}) == 1.0
    assert seen_ratio(["a"], set()) == 0.0
    assert seen_ratio([], {"a"}) == 0.0


def test_relevant_ids_follow_interaction_topics() -> None:
    coffee_user = next(u for u in USERS if u["id"] == "eval-user-coffee")
    relevant = relevant_ids(coffee_user["interactions"])
    expected = {
        post_id for post_id, post in POST_BY_ID.items() if post["topic"] == "coffee"
    }
    assert relevant == expected


def test_print_comparison_prints_every_recorded_metric(capsys) -> None:
    current = {
        "default": {"precision_at_k": 0.5, "diversity": 0.8, "seen_ratio": 0.0},
        "surprise": {"precision_at_k": 0.2, "diversity": 0.7, "seen_ratio": 0.0},
    }
    baseline = {"modes": {"default": {"precision_at_k": 0.7, "seen_ratio": 0.0}}}
    regressions = print_comparison(current, baseline, tolerance=0.05)
    out = capsys.readouterr().out
    # Recorded metrics are printed explicitly, unrecorded ones are skipped.
    assert "baseline=0.700" in out and "current=0.500" in out
    assert "seen_ratio" in out
    assert "surprise" not in out
    assert [(mode, key, base, cur) for mode, key, base, cur in regressions] == [
        ("default", "precision_at_k", 0.7, 0.5)
    ]


def test_print_comparison_marks_passing_metrics_ok(capsys) -> None:
    current = {
        "default": {"precision_at_k": 0.7, "diversity": 0.8, "seen_ratio": 0.0},
        "surprise": {"precision_at_k": 0.1, "diversity": 0.8, "seen_ratio": 0.0},
    }
    baseline = {"modes": {"default": {"precision_at_k": 0.7}}}
    assert print_comparison(current, baseline, tolerance=0.05) == []
    out = capsys.readouterr().out
    assert "(ok" in out
    assert "REGRESSION" not in out


# --- Dataset shape ---


def test_corpus_ids_are_unique_24_hex() -> None:
    ids = [post["post_id"] for post in CORPUS]
    assert len(ids) == len(set(ids))
    for post_id in ids:
        assert HEX24.match(post_id), f"bad id: {post_id}"


def test_every_topic_has_enough_posts() -> None:
    by_topic: dict[str, int] = {}
    for post in CORPUS:
        by_topic[post["topic"]] = by_topic.get(post["topic"], 0) + 1
    assert len(by_topic) >= 4
    assert all(count >= 3 for count in by_topic.values())


def test_interactions_reference_known_posts_and_kinds() -> None:
    for user in USERS:
        for post_id, kind in user["interactions"]:
            assert post_id in POST_BY_ID, f"{user['id']}: unknown post {post_id}"
            assert kind in {"view", "like", "save"}, f"bad kind {kind}"


def test_held_out_is_same_topic_and_disjoint_from_train() -> None:
    for user in USERS:
        train_topics = {
            POST_BY_ID[post_id]["topic"] for post_id, _ in user["interactions"]
        }
        train_ids = {post_id for post_id, _ in user["interactions"]}
        for post_id in user["held_out_post_ids"]:
            assert post_id in POST_BY_ID, f"{user['id']}: unknown held-out {post_id}"
            assert post_id not in train_ids, f"{user['id']}: held-out also trained"
            assert POST_BY_ID[post_id]["topic"] in train_topics, (
                f"{user['id']}: held-out topic outside history"
            )


def test_cold_start_user_has_no_history() -> None:
    cold = [u for u in USERS if u["cold_start"]]
    assert cold, "dataset must include a cold-start user"
    for user in cold:
        assert user["interactions"] == []
        assert user["held_out_post_ids"] == []


def test_profiled_users_have_interactions_and_unique_ids() -> None:
    profiled = [u for u in USERS if not u["cold_start"]]
    assert profiled, "dataset must include profiled users"
    for user in profiled:
        assert user["interactions"], f"{user['id']} has no interactions"
        assert user["held_out_post_ids"], f"{user['id']} has no held-out posts"
    ids = [user["id"] for user in USERS]
    assert len(ids) == len(set(ids))
