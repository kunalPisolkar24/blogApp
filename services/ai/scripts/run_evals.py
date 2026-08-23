#!/usr/bin/env python3
"""Unified evaluation harness for the Topos AI service.

Single entry point over the eval suites (#162). Runs the selected suites
against a live ai-service and exits non-zero when any of them regresses, so
local or future automation can gate on it:

* ``chat`` -- deterministic citation checks plus optional LLM-as-judge
  relevance/faithfulness scoring on the ``topos-chat-eval`` dataset
  (``scripts/eval_chat.py``, issue #161). Negative rows fail on invented
  citations; citing known posts is reported only.
* ``reco`` -- precision@k, tag diversity and seen-ratio against a recorded
  baseline (``scripts/eval_reco.py``, issue #163).

Baseline comparison is explicit: recorded scores are printed next to the
current ones per metric. The reco baseline is written with
``--update-baseline``; the chat gate uses fixed minimum thresholds instead of
a baseline file.

This is a local gate on purpose: no CI/workflow wiring.

Usage:
    make eval-all             # every suite
    make eval-chat            # chat only
    make eval-reco            # reco only, compared to its baseline
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

import grpc

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import eval_chat
import eval_reco
from reco_eval_data import DEFAULT_K
from verify_eval_dataset import index_corpus as index_chat_corpus

from src.config import settings
from src.generated import ai_service_pb2, ai_service_pb2_grpc


def clear_eval_posts(stub: ai_service_pb2_grpc.AIServiceStub) -> None:
    """Remove every post belonging to either eval corpus from the index.

    Both corpora share the service's persistent ``posts`` Qdrant collection;
    without this, a suite would retrieve (and cite) the other suite's posts
    and any leftovers from earlier runs.
    """
    corpus_ids = [post["post_id"] for post in eval_chat.CORPUS] + [
        post["post_id"] for post in eval_reco.CORPUS
    ]
    for post_id in corpus_ids:
        stub.DeletePost(ai_service_pb2.DeleteRequest(post_id=post_id))


def run_chat_suite(
    stub: ai_service_pb2_grpc.AIServiceStub, args: argparse.Namespace
) -> int:
    print(f"== chat suite: scoring {len(eval_chat.CURATED_QA)} curated rows ==")
    clear_eval_posts(stub)
    index_chat_corpus(stub)

    judges_on = not args.no_judges and settings.LLM_MODE == "real"
    if not args.no_judges and settings.LLM_MODE != "real":
        print("Judges skipped (need AI_LLM_MODE=real); deterministic checks only.")

    if args.upload:
        failures, experiment_name = asyncio.run(
            eval_chat.run_langsmith_experiment(stub, judges_on)
        )
        print(f"Experiment '{experiment_name}' recorded in LangSmith.")
        return failures

    summary = asyncio.run(eval_chat.run_suite(stub, judges_on))
    eval_chat.print_summary(summary, judges_on)
    failures = summary["counts"]["failed"]
    if judges_on:
        failures += eval_chat.gate_regressions(
            summary, args.min_relevance, args.min_faithfulness
        )
    if summary["counts"]["error"]:
        print(
            f"warning: {summary['counts']['error']} row(s) hit a transient error "
            "and were skipped; re-run to cover them."
        )
    return failures


def run_reco_suite(
    stub: ai_service_pb2_grpc.AIServiceStub, args: argparse.Namespace
) -> int:
    k = args.k if args.k is not None else DEFAULT_K
    print(f"== reco suite: scoring feeds (k={k}) ==")
    clear_eval_posts(stub)
    eval_reco.index_corpus(stub)

    summary = eval_reco.run_suite(stub, k)
    for mode, metrics in summary.items():
        pretty = ", ".join(f"{key}={metrics[key]:.3f}" for key in eval_reco.METRIC_KEYS)
        print(f"  [{mode:>8}] {pretty}, cold_start_users={metrics['cold_start_users']}")

    if args.update_baseline:
        eval_reco.write_baseline(args.baseline_path, summary, k, args.tolerance)
        print(f"Baseline written to {args.baseline_path}")
        return 0

    baseline = eval_reco.load_baseline(args.baseline_path)
    if baseline is None:
        print(
            f"No baseline at {args.baseline_path}. Record one first with "
            "`make eval-reco-baseline`."
        )
        return 1

    regressions = eval_reco.print_comparison(summary, baseline, args.tolerance)
    return len(regressions)


SUITES = {"chat": run_chat_suite, "reco": run_reco_suite}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--suite",
        choices=[*SUITES, "all"],
        default="all",
        help="which eval suite(s) to run (default: all)",
    )
    parser.add_argument("--address", default="127.0.0.1:50051")

    chat_group = parser.add_argument_group("chat suite")
    chat_group.add_argument(
        "--no-judges",
        action="store_true",
        help="skip the LLM-as-judge scoring; deterministic checks only",
    )
    chat_group.add_argument(
        "--min-relevance",
        type=float,
        default=0.7,
        help="minimum average relevance score before failing (default: 0.7)",
    )
    chat_group.add_argument(
        "--min-faithfulness",
        type=float,
        default=0.7,
        help="minimum average faithfulness score before failing (default: 0.7)",
    )
    chat_group.add_argument(
        "--upload",
        action="store_true",
        help=(
            "record a LangSmith experiment for the chat suite instead of "
            "running it locally; needs LANGSMITH_API_KEY and the dataset "
            "pushed via make eval-dataset"
        ),
    )

    reco_group = parser.add_argument_group("reco suite")
    reco_group.add_argument(
        "--k", type=int, default=None, help="feed depth (default: dataset DEFAULT_K)"
    )
    reco_group.add_argument(
        "--tolerance",
        type=float,
        default=0.05,
        help="allowed absolute metric drop vs baseline before failing (default: 0.05)",
    )
    reco_group.add_argument(
        "--update-baseline",
        action="store_true",
        help="record a fresh reco baseline instead of comparing",
    )
    reco_group.add_argument(
        "--baseline-path",
        type=Path,
        default=SCRIPT_DIR / "reco_eval_baseline.json",
    )
    args = parser.parse_args(argv)

    selected = list(SUITES) if args.suite == "all" else [args.suite]

    channel = grpc.insecure_channel(args.address)
    grpc.channel_ready_future(channel).result(timeout=30)
    stub = ai_service_pb2_grpc.AIServiceStub(channel)

    problems = 0
    try:
        for suite in selected:
            problems += SUITES[suite](stub, args)
    finally:
        channel.close()

    label = "+".join(selected)
    if problems:
        print(f"FAILED: {problems} problem(s) across [{label}].")
        return 1
    print(f"OK: no regressions across [{label}].")
    return 0


if __name__ == "__main__":
    sys.exit(main())
