#!/usr/bin/env python3
"""Validate the eval dataset against a live ai-service chat (real or fake LLM).

Indexes the fixed corpus from ``scripts/eval_data.py`` and, for every curated
row, streams ``ChatAnswer`` and collects the cited post ids, then checks
citation quality:

* grounded rows -- every expected post id must be cited. This is a hard
  failure (exit 1): if the model disagrees with the authored expectations the
  dataset needs fixing.
* negative rows -- the dataset expects no citations. We REPORT whether the
  assistant cited anything but do NOT fail the run, because citation
  suppression for loosely-retrieved posts is a retrieval/prompt concern, not a
  dataset defect (kept out of issue #160's scope).

Requires the service-level stack up (services/ai/compose.local.yml). Set
AI_LLM_MODE=real with LIGHTNING_AI_API_KEY / AI_LIGHTNING_MODEL for a real-LLM
run; otherwise it validates the fake-LLM path.

Usage:
    make eval-verify-chat
    poetry run python scripts/verify_eval_dataset.py   # retrieval check
    poetry run python scripts/verify_eval_chat.py      # citation check
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import grpc

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from eval_data import CORPUS, CURATED_QA
from verify_eval_dataset import index_corpus

from src.generated import ai_service_pb2, ai_service_pb2_grpc

CHAT_TOP_K = 5


def chat_citations(
    stub: ai_service_pb2_grpc.AIServiceStub,
    query: str,
    history: list[tuple[str, str]],
    retries: int = 4,
) -> list[str]:
    messages = [
        ai_service_pb2.ChatMessage(role=role, content=content)
        for role, content in history
    ]
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            cited: list[str] = []
            for chunk in stub.ChatAnswer(
                ai_service_pb2.ChatAnswerRequest(
                    query=query, top_k=CHAT_TOP_K, history=messages
                )
            ):
                if chunk.done:
                    cited = list(chunk.cited_post_ids)
            return cited
        except grpc.RpcError as exc:  # transient LLM/provider blips
            last_error = exc
            if exc.code() != grpc.StatusCode.UNAVAILABLE:
                raise
            time.sleep(2**attempt)
    assert last_error is not None
    raise last_error


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--address", default="127.0.0.1:50051")
    args = parser.parse_args()

    channel = grpc.insecure_channel(args.address)
    grpc.channel_ready_future(channel).result(timeout=30)
    stub = ai_service_pb2_grpc.AIServiceStub(channel)

    print(f"Indexing {len(CORPUS)} corpus posts...")
    index_corpus(stub)

    failures = 0
    negatives_cited = 0
    transient_errors = 0
    for row in CURATED_QA:
        history = row.get("history", [])
        try:
            cited = chat_citations(stub, row["query"], history)
        except grpc.RpcError as exc:
            transient_errors += 1
            print(f"  [ERROR {exc.code().name}] {row['id']} ({row['query']})")
            continue
        if row["category"] == "grounded":
            missing = [pid for pid in row["expected_post_ids"] if pid not in cited]
            if missing:
                failures += 1
                print(f"  [MISSING {missing}] {row['id']} -> cited {cited}")
            else:
                print(f"  [OK] {row['id']} ({row['query']}) -> {cited}")
        else:
            if cited:
                negatives_cited += 1
            print(f"  [neg {row['category']}] {row['id']} -> {cited or 'none'}")

    channel.close()

    print()
    if failures:
        print(f"FAILED: {failures} grounded row(s) were not fully cited.")
    else:
        print("OK: every grounded expected post was cited by the assistant.")
    if negatives_cited:
        print(
            f"note: {negatives_cited} negative row(s) were cited despite the "
            "dataset expecting none -- a retrieval/prompt gap, not a dataset "
            "defect (see issue #160 scope)."
        )
    if transient_errors:
        print(
            f"warning: {transient_errors} row(s) hit a transient LLM/provider "
            "error and were skipped; re-run to cover them."
        )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
