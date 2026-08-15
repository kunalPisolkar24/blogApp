#!/usr/bin/env python3
"""Smoke-test grounded chat against the running local stack with a real LLM.

Usage
-----
Start the stack first (services/ai/.env must set ``LIGHTNING_AI_API_KEY``
and ``AI_LLM_MODE=real`` for a real model):

    docker compose -f services/ai/compose.local.yml up --build

then, from services/ai:

    poetry run python scripts/smoke_chat.py

What it does
------------
1. Indexes a small corpus of factual posts about the platform's own stack
   (MongoDB, Redis, Kafka, Qdrant, Ollama) through the ``IndexPost`` RPC,
   so the answers have real content to be grounded in.
2. Asks each question through the streaming ``ChatAnswer`` RPC and prints
   the answer with its cited post ids.
3. Scrapes the service's ``/metrics`` endpoint to show the token usage
   the provider reported for the chat calls.

Exits non-zero if a stream fails or a question gets no citations
(``--no-require-citations`` relaxes the latter, useful against fake
embeddings which only match exact text).
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import grpc
import httpx

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.generated import (
    ai_service_pb2,
    ai_service_pb2_grpc,
)

CORPUS = [
    {
        "post_id": "0a0a0a0a0a0a0a0a0a0a0a01",
        "title": "MongoDB at Topos",
        "body": (
            "Topos stores all blog content in MongoDB: posts, tags, chats and "
            "their messages live in the blog_content database and are read "
            "back through indexed queries."
        ),
    },
    {
        "post_id": "0a0a0a0a0a0a0a0a0a0a0a02",
        "title": "Redis Caching at Topos",
        "body": (
            "The content service caches posts, tags, search and related "
            "results in Redis to keep read latency low. The cache is "
            "best-effort: if Redis is down the service falls back to MongoDB."
        ),
    },
    {
        "post_id": "0a0a0a0a0a0a0a0a0a0a0a03",
        "title": "Kafka Events at Topos",
        "body": (
            "Post mutations are published to the Kafka posts topic. Background "
            "workers consume the events to generate summaries and to index "
            "posts in the Qdrant vector store."
        ),
    },
    {
        "post_id": "0a0a0a0a0a0a0a0a0a0a0a04",
        "title": "Qdrant Vector Search at Topos",
        "body": (
            "Semantic search and related posts run on Qdrant with hybrid "
            "dense and sparse vectors. Chat answers are grounded by retrieving "
            "the nearest posts to the user question from Qdrant."
        ),
    },
    {
        "post_id": "0a0a0a0a0a0a0a0a0a0a0a05",
        "title": "Ollama Embeddings at Topos",
        "body": (
            "Posts and chat queries are embedded with Ollama running the "
            "snowflake-arctic-embed2 model before they are stored in or "
            "searched against the vector store."
        ),
    },
]

QUESTIONS = [
    "does the mongodb store the data?",
    "how does the platform cache content?",
    "what role does kafka play?",
    "how does semantic search work?",
    "what generates the embeddings?",
]

METRIC_RE = re.compile(
    r'^llm_tokens_total\{method="(?P<method>[^"]+)",'
    r'token_type="(?P<token_type>[^"]+)"\}\s+(?P<value>[\d.]+)$'
)


def index_posts(stub: ai_service_pb2_grpc.AIServiceStub) -> None:
    for post in CORPUS:
        request = ai_service_pb2.IndexRequest(
            post_id=post["post_id"],
            title=post["title"],
            body=post["body"],
            summary="",
            tags=[],
            created_at="2026-01-01T00:00:00Z",
        )
        stub.IndexPost(request)


def ask(stub: ai_service_pb2_grpc.AIServiceStub, query: str) -> tuple[str, list[str]]:
    """Stream one grounded answer; returns (text, cited post ids)."""
    answer_parts: list[str] = []
    cited: list[str] = []
    for chunk in stub.ChatAnswer(
        ai_service_pb2.ChatAnswerRequest(query=query, top_k=3)
    ):
        if chunk.delta:
            answer_parts.append(chunk.delta)
        if chunk.done:
            cited = list(chunk.cited_post_ids)
    return "".join(answer_parts), cited


def scrape_token_usage(metrics_url: str) -> dict[tuple[str, str], float]:
    """Return llm_tokens_total per (method, token_type) from /metrics."""
    response = httpx.get(metrics_url, timeout=5)
    response.raise_for_status()
    usage: dict[tuple[str, str], float] = {}
    for line in response.text.splitlines():
        match = METRIC_RE.match(line)
        if match:
            usage[(match.group("method"), match.group("token_type"))] = float(
                match.group("value")
            )
    return usage


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--address",
        default="127.0.0.1:50051",
        help="gRPC address of the ai-service (default: 127.0.0.1:50051)",
    )
    parser.add_argument(
        "--metrics-url",
        default="http://127.0.0.1:12666/metrics",
        help="Prometheus endpoint of the ai-service (default: localhost:12666)",
    )
    parser.add_argument(
        "--no-require-citations",
        action="store_true",
        help="do not fail when a question retrieves no posts (fake embeddings)",
    )
    args = parser.parse_args()

    channel = grpc.insecure_channel(args.address)
    grpc.channel_ready_future(channel).result(timeout=15)
    stub = ai_service_pb2_grpc.AIServiceStub(channel)

    try:
        index_posts(stub)
        print(f"indexed {len(CORPUS)} posts")

        before = scrape_token_usage(args.metrics_url)
        failures = 0
        for query in QUESTIONS:
            answer, cited = ask(stub, query)
            cited_titles = [
                next(
                    (post["title"] for post in CORPUS if post["post_id"] == post_id),
                    post_id,
                )
                for post_id in cited
            ]
            print(f"\nQ: {query}\nA: {answer}")
            print(f"  cited: {cited_titles or 'none'}")
            if not answer.strip():
                print("  ERROR: empty answer")
                failures += 1
            elif not cited and not args.no_require_citations:
                print("  ERROR: no posts cited")
                failures += 1
        after = scrape_token_usage(args.metrics_url)

        for token_type in ("prompt", "completion", "total"):
            streamed = after.get(("stream", token_type), 0.0)
            completion = after.get(("completion", token_type), 0.0)
            delta = (streamed + completion) - (
                before.get(("stream", token_type), 0.0)
                + before.get(("completion", token_type), 0.0)
            )
            print(f"\ntokens ({token_type}): {delta:.0f}")

        return 1 if failures else 0
    finally:
        channel.close()


if __name__ == "__main__":
    sys.exit(main())
