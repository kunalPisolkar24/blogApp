#!/usr/bin/env python3
"""Recommender evaluation harness for the Topos personalized feed.

Indexes the fixed corpus from ``scripts/reco_eval_data.py`` into a running
ai-service, folds each synthetic user's interactions into a taste profile via
``UpdateUserProfile``, then scores ``RecommendFeed`` in DEFAULT and SURPRISE
modes:

* ``precision_at_k`` -- fraction of the top-k feed whose post topic matches a
  topic from the user's interaction history.
* ``diversity``      -- tag spread across the top-k feed: distinct tags over
  total tag occurrences (tags come from the authored corpus; RecommendFeed
  returns ids only).
* ``seen_ratio``     -- fraction of the feed already interacted with. The
  service filters seen posts, so this is expected to stay at 0.0; the metric
  proves that invariant.

Users without history (cold start) are reported separately and never
aggregated, since their feed is empty by design.

Baseline / gate
---------------
The first run should record a baseline:

    make eval-reco-baseline

Later runs compare against ``reco_eval_baseline.json`` (gitignored) and exit
non-zero when any metric drops by more than ``--tolerance``. This is a local
gate on purpose: no CI wiring, run it before/after recommender changes.

Requires the service-level stack (services/ai/compose.local.yml); real
embeddings make same-topic posts rank together. RecommendFeed never calls the
LLM, so LLM_MODE=fake is fine.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import grpc

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from reco_eval_data import CORPUS, DEFAULT_K, POST_BY_ID, SURPRISE_SEED, USERS

from src.generated import ai_service_pb2, ai_service_pb2_grpc

METRIC_KEYS = ("precision_at_k", "diversity", "seen_ratio")
KINDS = {
    "view": ai_service_pb2.INTERACTION_KIND_VIEW,
    "like": ai_service_pb2.INTERACTION_KIND_LIKE,
    "save": ai_service_pb2.INTERACTION_KIND_SAVE,
}
MODES = {
    "default": ai_service_pb2.RECOMMEND_MODE_DEFAULT,
    "surprise": ai_service_pb2.RECOMMEND_MODE_SURPRISE,
}
POST_BY_ID_TAGS = {post_id: post["tags"] for post_id, post in POST_BY_ID.items()}


def precision_at_k(recommended: list[str], relevant: set[str], k: int) -> float:
    """Fraction of the top-k feed that is relevant.

    The denominator is the page actually returned (capped at k) so a small
    corpus is not penalized for serving fewer than k posts.
    """
    top = recommended[:k]
    if not top:
        return 0.0
    return sum(1 for post_id in top if post_id in relevant) / len(top)


def tag_diversity(recommended: list[str], tags_by_id: dict[str, list[str]]) -> float:
    """Distinct-tag share of all tags attached to the recommended posts.

    1.0 means every tag is unique across the feed; lower values mean the feed
    leans on repeated tags.
    """
    tags = [tag for post_id in recommended for tag in tags_by_id.get(post_id, [])]
    if not tags:
        return 0.0
    return len(set(tags)) / len(tags)


def seen_ratio(recommended: list[str], seen: set[str]) -> float:
    """Fraction of the feed the user has already interacted with."""
    if not recommended:
        return 0.0
    return sum(1 for post_id in recommended if post_id in seen) / len(recommended)


def relevant_ids(interactions: list[tuple[str, str]]) -> set[str]:
    """Corpus posts whose topic appears in the user's interaction history."""
    topics = {
        POST_BY_ID[post_id]["topic"]
        for post_id, _ in interactions
        if post_id in POST_BY_ID
    }
    return {pid for pid, post in POST_BY_ID.items() if post["topic"] in topics}


def index_corpus(stub: ai_service_pb2_grpc.AIServiceStub) -> None:
    created_at = datetime.now(UTC)
    for post in CORPUS:
        stub.IndexPost(
            ai_service_pb2.IndexRequest(
                post_id=post["post_id"],
                title=post["title"],
                body=post["body"],
                summary=post["summary"],
                tags=list(post["tags"]),
                created_at=created_at,
            )
        )


def seed_profiles(
    stub: ai_service_pb2_grpc.AIServiceStub, scope: str
) -> dict[str, str]:
    """Fold every user's interactions under a run-scoped profile id.

    The service exposes no profile delete, so each run folds fresh profiles
    under unique ids (``<dataset-id>-<scope>``) instead of re-folding on top
    of a previous run's accumulated weight. Returns dataset id -> runtime id.
    """
    runtime_ids: dict[str, str] = {}
    for user in USERS:
        runtime_id = f"{user['id']}-{scope}"
        runtime_ids[user["id"]] = runtime_id
        for post_id, kind in user["interactions"]:
            stub.UpdateUserProfile(
                ai_service_pb2.UserProfileUpdateRequest(
                    user_id=runtime_id,
                    post_id=post_id,
                    kind=KINDS[kind],
                )
            )
    return runtime_ids


def recommend(
    stub: ai_service_pb2_grpc.AIServiceStub, user_id: str, mode: str, k: int
) -> tuple[list[str], bool]:
    """Fetch one feed page; returns (post_ids, cold_start)."""
    request = ai_service_pb2.RecommendRequest(
        user_id=user_id,
        offset=0,
        limit=k,
        mode=MODES[mode],
    )
    if mode == "surprise":
        request.seed = SURPRISE_SEED
    response = stub.RecommendFeed(request)
    return list(response.post_ids), response.total == 0


def run_suite(stub: ai_service_pb2_grpc.AIServiceStub, k: int) -> dict:
    """Score every user in both modes; returns aggregate metrics per mode."""
    runtime_ids = seed_profiles(stub, scope=uuid4().hex[:8])
    per_mode: dict[str, dict[str, list[float]]] = {
        mode: {key: [] for key in METRIC_KEYS} for mode in MODES
    }
    cold_starts = {mode: 0 for mode in MODES}

    for user in USERS:
        seen = {post_id for post_id, _ in user["interactions"]}
        relevant = relevant_ids(user["interactions"])
        for mode in MODES:
            recommended, cold_start = recommend(stub, runtime_ids[user["id"]], mode, k)
            print(f"  [{mode:>8}] {user['id']:<24} {recommended or ['<empty>']}")
            if cold_start or user["cold_start"]:
                cold_starts[mode] += 1
                continue
            per_mode[mode]["precision_at_k"].append(
                precision_at_k(recommended, relevant, k)
            )
            per_mode[mode]["diversity"].append(
                tag_diversity(recommended, POST_BY_ID_TAGS)
            )
            per_mode[mode]["seen_ratio"].append(seen_ratio(recommended, seen))

    summary: dict[str, dict[str, float]] = {}
    for mode, buckets in per_mode.items():
        summary[mode] = {
            key: sum(values) / len(values) if values else 0.0
            for key, values in buckets.items()
        }
        summary[mode]["cold_start_users"] = cold_starts[mode]
    return summary


def load_baseline(path: Path) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def find_regressions(
    current: dict, baseline: dict, tolerance: float
) -> list[tuple[str, str, float, float]]:
    """Metric drops beyond tolerance: (mode, metric, baseline, current)."""
    regressions: list[tuple[str, str, float, float]] = []
    for mode in MODES:
        base_mode = baseline.get("modes", {}).get(mode, {})
        cur_mode = current[mode]
        for key in METRIC_KEYS:
            if key not in base_mode:
                continue
            drop = base_mode[key] - cur_mode[key]
            if drop > tolerance:
                regressions.append((mode, key, base_mode[key], cur_mode[key]))
    return regressions


def write_baseline(path: Path, summary: dict, k: int, tolerance: float) -> None:
    payload = {
        "k": k,
        "tolerance": tolerance,
        "recorded_at": datetime.now(UTC).isoformat(),
        "modes": summary,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--address", default="127.0.0.1:50051")
    parser.add_argument(
        "--k", type=int, default=None, help="feed depth (default: dataset DEFAULT_K)"
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=0.05,
        help="allowed absolute metric drop vs baseline before failing (default: 0.05)",
    )
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="record a fresh baseline instead of comparing",
    )
    parser.add_argument(
        "--baseline-path",
        type=Path,
        default=SCRIPT_DIR / "reco_eval_baseline.json",
    )
    args = parser.parse_args(argv)

    channel = grpc.insecure_channel(args.address)
    grpc.channel_ready_future(channel).result(timeout=30)
    stub = ai_service_pb2_grpc.AIServiceStub(channel)

    k = args.k if args.k is not None else DEFAULT_K

    print(f"Indexing {len(CORPUS)} corpus posts...")
    index_corpus(stub)

    print(f"Scoring feeds (k={k})...")
    summary = run_suite(stub, k)
    channel.close()

    for mode, metrics in summary.items():
        pretty = ", ".join(f"{key}={metrics[key]:.3f}" for key in METRIC_KEYS)
        print(f"{mode:>8}: {pretty}, cold_start_users={metrics['cold_start_users']}")

    if args.update_baseline:
        write_baseline(args.baseline_path, summary, k, args.tolerance)
        print(f"Baseline written to {args.baseline_path}")
        return 0

    baseline = load_baseline(args.baseline_path)
    if baseline is None:
        print(
            f"No baseline at {args.baseline_path}. Record one first with "
            "`make eval-reco-baseline`."
        )
        return 1

    regressions = find_regressions(summary, baseline, args.tolerance)
    if regressions:
        for mode, key, base, cur in regressions:
            print(
                f"REGRESSION {mode}.{key}: baseline={base:.3f} "
                f"current={cur:.3f} (tolerance={args.tolerance})"
            )
        return 1
    print("OK: no recommender regression vs baseline.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
