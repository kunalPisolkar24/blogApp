#!/usr/bin/env python3
"""Verify the curated eval dataset is actually grounded by the retriever.

This is a service-level check: it indexes the fixed corpus from
``scripts/eval_data.py`` into a running ai-service and, for every curated
question, asks the real (Ollama) retriever which posts it would ground on via
``SearchPosts``. It confirms the authored ``expected_post_ids`` are reachable
by retrieval (the precondition for the chat assistant to cite them).

It does NOT require a real LLM: it validates retrieval recall, not citation
selection. Negative rows (gibberish / out-of-scope) are reported for
inspection; asserting empty retrieval for keyword salads is intentionally not
enforced here because the dense threshold can still surface loosely related
posts -- citation suppression for those is the LLM's job at chat time.

Requires the service-level stack:
    docker compose -f services/ai/compose.local.yml up -d --build

Usage:
    poetry run python scripts/verify_eval_dataset.py
    poetry run python scripts/verify_eval_dataset.py --address 127.0.0.1:50051
"""

from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path

import grpc

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from eval_data import CORPUS, CURATED_QA

from src.generated import ai_service_pb2, ai_service_pb2_grpc

RETRIEVE_LIMIT = 10
CREATED_AT = datetime(2026, 1, 1, tzinfo=UTC)


def index_corpus(stub: ai_service_pb2_grpc.AIServiceStub) -> None:
    for post in CORPUS:
        stub.IndexPost(
            ai_service_pb2.IndexRequest(
                post_id=post["post_id"],
                title=post["title"],
                body=post["body"],
                summary=post.get("summary", ""),
                tags=list(post.get("tags", [])),
                created_at=CREATED_AT,
            )
        )


def retrieve(stub: ai_service_pb2_grpc.AIServiceStub, query: str) -> list[str]:
    response = stub.SearchPosts(
        ai_service_pb2.SearchRequest(query=query, limit=RETRIEVE_LIMIT)
    )
    return list(response.post_ids)


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
    negative_reports = 0
    for row in CURATED_QA:
        retrieved = retrieve(stub, row["query"])
        if row["category"] == "grounded":
            missing = [pid for pid in row["expected_post_ids"] if pid not in retrieved]
            status = "OK" if not missing else f"MISSING {missing}"
            if missing:
                failures += 1
            print(f"  [{status}] {row['id']} ({row['query']}) -> {retrieved}")
        else:
            if retrieved:
                negative_reports += 1
            print(f"  [neg {row['category']}] {row['id']} -> {retrieved or 'none'}")

    channel.close()

    print()
    if failures:
        print(f"FAILED: {failures} grounded row(s) had unreachable expected posts.")
        return 1
    print("OK: every grounded expected post is retrievable by the real retriever.")
    if negative_reports:
        print(
            f"note: {negative_reports} negative row(s) still retrieved posts; "
            "citation suppression is the LLM's job at chat time."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
