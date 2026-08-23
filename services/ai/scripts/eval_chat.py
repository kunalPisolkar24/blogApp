"""Chat evaluators for the Topos grounded assistant.

Scores every row of the curated chat eval dataset (``scripts/eval_data.py``,
LangSmith dataset ``topos-chat-eval``) against a running ai-service with two
kinds of evaluators:

* Deterministic -- grounded rows must cite every expected post id (citations
  non-empty, nothing outside the corpus); gibberish and out-of-scope rows
  must never invent posts. Violations are re-checked once (answers are
  sampled) and fail the run loudly when they persist.
* LLM-as-judge -- relevance (does the answer address the question?) and
  faithfulness (is it supported by the cited posts?). Judges need a real LLM
  (``AI_LLM_MODE=real``); under fake mode they are skipped and only the
  deterministic gate applies. Average scores below the configured minimums
  fail the run.

The optional LangSmith path (``run_langsmith_experiment``) runs the same
target and evaluators through ``langsmith.aevaluate`` so per-row feedback is
visible as an experiment on the uploaded dataset; it requires
``LANGSMITH_API_KEY`` and a dataset pushed with ``make eval-dataset``.

Driven by ``scripts/run_evals.py`` (--suite chat); needs the service-level
stack up (services/ai/compose.local.yml).
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path

import grpc

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from eval_data import CORPUS, CURATED_QA, DATASET_NAME

from src.generated import ai_service_pb2, ai_service_pb2_grpc
from src.llm import LLMClient, LLMProvider

CHAT_TOP_K = 5
CORPUS_BY_ID = {post["post_id"]: post for post in CORPUS}
CORPUS_IDS = set(CORPUS_BY_ID)

# --- Deterministic evaluators ---


def citation_problems(
    category: str,
    expected_post_ids: list[str],
    cited_post_ids: list[str],
    corpus_ids: set[str] | None = None,
) -> list[str]:
    """Deterministic citation checks; returns human-readable problems.

    Grounded rows must cite every expected post id and may only cite posts
    from the corpus. Negative rows must never invent posts: citations outside
    the corpus fail, while known-corpus citations on negative rows are only
    reported (suppression for loosely-retrieved posts is a prompt/retrieval
    concern -- see ``verify_eval_chat.py``).
    """
    corpus_ids = CORPUS_IDS if corpus_ids is None else corpus_ids
    problems: list[str] = []
    if category == "grounded":
        missing = [pid for pid in expected_post_ids if pid not in cited_post_ids]
        if missing:
            problems.append(f"missing citations: {missing}")
        invented = [pid for pid in cited_post_ids if pid not in corpus_ids]
        if invented:
            problems.append(f"cited unknown posts: {invented}")
        if not cited_post_ids:
            problems.append("cited nothing")
    else:
        invented = sorted(pid for pid in cited_post_ids if pid not in corpus_ids)
        if invented:
            problems.append(f"invented citations: {invented}")
    return problems


def grounding_contexts(cited_post_ids: list[str]) -> list[tuple[str, str]]:
    """(title, body) excerpts for the cited corpus posts, in cited order.

    Unknown ids are skipped; the faithfulness judge only sees what the
    assistant actually drew from.
    """
    contexts: list[tuple[str, str]] = []
    for post_id in cited_post_ids:
        post = CORPUS_BY_ID.get(post_id)
        if post is not None:
            contexts.append((post["title"], post["body"]))
    return contexts


# --- LLM-as-judge evaluators ---

EVAL_RELEVANCE_JUDGE_PROMPT = (
    "You are an evaluation judge for a blog platform assistant. Score how "
    "well the assistant's response addresses the user's question: 1.0 means "
    "it answers fully and directly, 0.0 means it ignores or dodges the "
    "question. An honest statement that nothing relevant was found counts as "
    "addressing nonsense or out-of-scope questions. Return ONLY a raw JSON "
    'object: {"score": a 0.0-1.0 score}. No explanation, no markdown.'
)

EVAL_FAITHFULNESS_JUDGE_PROMPT = (
    "You are an evaluation judge for a grounded assistant. Given a response "
    "and the source excerpts it cites, score whether every claim is supported "
    "by those excerpts: 1.0 means fully supported, 0.0 means it invents "
    "facts. A refusal that claims nothing relevant was found is faithful when "
    "the excerpts do not answer the question. Ignore citation marker numbers. "
    'Return ONLY a raw JSON object: {"score": a 0.0-1.0 score}. No '
    "explanation, no markdown."
)

_JSON_OBJECT_RE = re.compile(r"\{[^{}]*\}", re.DOTALL)


def relevance_user_prompt(query: str, answer: str) -> str:
    return f"Question: {query}\n\nResponse: {answer}"


def faithfulness_user_prompt(
    query: str, answer: str, contexts: list[tuple[str, str]]
) -> str:
    excerpts = "\n\n".join(
        f"[{index}] {title}\n{body}"
        for index, (title, body) in enumerate(contexts, start=1)
    )
    if not contexts:
        excerpts = "(none)"
    return f"Question: {query}\n\nResponse: {answer}\n\nExcerpts:\n{excerpts}"


def parse_judge_score(raw: str) -> float | None:
    """Extract a 0.0-1.0 score from a judge reply; None when unparseable."""
    match = _JSON_OBJECT_RE.search(raw or "")
    if match is None:
        return None
    try:
        score = float(json.loads(match.group(0))["score"])
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        return None
    return min(max(score, 0.0), 1.0)


async def judge_scores(
    llm: LLMProvider, query: str, answer: str, cited_post_ids: list[str]
) -> tuple[float | None, float | None]:
    """Score one row with both judges; returns (relevance, faithfulness)."""
    relevance_raw = await llm.generate_completion(
        EVAL_RELEVANCE_JUDGE_PROMPT,
        relevance_user_prompt(query, answer),
    )
    faithfulness_raw = await llm.generate_completion(
        EVAL_FAITHFULNESS_JUDGE_PROMPT,
        faithfulness_user_prompt(query, answer, grounding_contexts(cited_post_ids)),
    )
    return parse_judge_score(relevance_raw), parse_judge_score(faithfulness_raw)


# Shared by the local run and the LangSmith evaluators; created lazily so
# importing this module never builds HTTP machinery.
_JUDGE_LLM: LLMClient | None = None


def judge_llm() -> LLMProvider:
    global _JUDGE_LLM
    if _JUDGE_LLM is None:
        _JUDGE_LLM = LLMClient()
    return _JUDGE_LLM


# --- Live-stack runner ---


async def chat_answer(
    stub: ai_service_pb2_grpc.AIServiceStub,
    query: str,
    history: list[tuple[str, str]],
    retries: int = 4,
) -> tuple[str, list[str]]:
    """Stream one ChatAnswer turn; returns (answer text, cited post ids)."""
    messages = [
        ai_service_pb2.ChatMessage(role=role, content=content)
        for role, content in history
    ]
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            deltas: list[str] = []
            cited: list[str] = []
            for chunk in stub.ChatAnswer(
                ai_service_pb2.ChatAnswerRequest(
                    query=query, top_k=CHAT_TOP_K, history=messages
                )
            ):
                if chunk.done:
                    cited = list(chunk.cited_post_ids)
                else:
                    deltas.append(chunk.delta)
            return "".join(deltas), cited
        except grpc.RpcError as exc:  # transient LLM/provider blips
            last_error = exc
            if exc.code() != grpc.StatusCode.UNAVAILABLE:
                raise
            await asyncio.sleep(2**attempt)
    assert last_error is not None
    raise last_error


def make_chat_target(stub: ai_service_pb2_grpc.AIServiceStub):
    """LangSmith evaluate() target: dataset inputs -> chat outputs."""

    async def target(inputs: dict) -> dict:
        history = [
            (message["role"], message["content"])
            for message in inputs.get("history", [])
        ]
        answer, cited = await chat_answer(stub, inputs["query"], history)
        return {"answer": answer, "cited_post_ids": cited}

    return target


# --- Local run ---


async def run_suite(stub: ai_service_pb2_grpc.AIServiceStub, judges_on: bool) -> dict:
    """Score every curated row; returns the aggregate summary.

    Rows that violate the deterministic checks are re-run once: answers and
    query rewrites are sampled at temperature, so a borderline miss can pass
    on a second draw. A row only counts as failed when it persists across
    both attempts.
    """
    llm = judge_llm() if judges_on else None

    counts = {"ok": 0, "failed": 0, "error": 0, "negative_cited": 0}
    per_category: dict[str, dict[str, int]] = {}
    relevance_scores: list[float] = []
    faithfulness_scores: list[float] = []
    problem_rows: list[dict] = []

    for row in CURATED_QA:
        category_counts = per_category.setdefault(
            row["category"], {"ok": 0, "failed": 0}
        )
        try:
            answer, cited = await chat_answer(
                stub, row["query"], row.get("history", [])
            )
        except grpc.RpcError as exc:
            counts["error"] += 1
            print(f"  [ERROR {exc.code().name}] {row['id']} ({row['query']})")
            continue

        problems = citation_problems(row["category"], row["expected_post_ids"], cited)
        relevance = faithfulness = None
        if llm is not None:
            relevance, faithfulness = await judge_scores(
                llm, row["query"], answer, cited
            )
            if relevance is not None:
                relevance_scores.append(relevance)
            if faithfulness is not None:
                faithfulness_scores.append(faithfulness)

        if problems:
            counts["failed"] += 1
            category_counts["failed"] += 1
            problem_rows.append(row)
            print(f"  [FAIL] {row['id']} ({row['category']}) -> {problems}")
        elif row["category"] != "grounded" and cited:
            counts["ok"] += 1
            category_counts["ok"] += 1
            counts["negative_cited"] += 1
            print(
                f"  [warn] {row['id']} ({row['category']}) cited known "
                f"posts: {sorted(cited)}"
            )
        else:
            counts["ok"] += 1
            category_counts["ok"] += 1
            rel = f"{relevance:.2f}" if relevance is not None else "--"
            fai = f"{faithfulness:.2f}" if faithfulness is not None else "--"
            print(
                f"  [OK] {row['id']} ({row['category']}) rel={rel} "
                f"faith={fai} cited={len(cited)}"
            )

    if problem_rows:
        print(
            f"rechecking {len(problem_rows)} failing row(s) once "
            "(answers are sampled; one-off misses retry)..."
        )
        for row in problem_rows:
            try:
                _, cited = await chat_answer(stub, row["query"], row.get("history", []))
            except grpc.RpcError as exc:
                print(f"  [ERROR {exc.code().name}] {row['id']} on recheck")
                continue
            problems = citation_problems(
                row["category"], row["expected_post_ids"], cited
            )
            if not problems:
                counts["failed"] -= 1
                per_category[row["category"]]["failed"] -= 1
                per_category[row["category"]]["ok"] += 1
                print(f"  [ok*] {row['id']} recovered on recheck")
            else:
                print(f"  [FAIL] {row['id']} persisted -> {problems}")

    def average(values: list[float]) -> float | None:
        return sum(values) / len(values) if values else None

    return {
        "counts": counts,
        "per_category": per_category,
        "avg_relevance": average(relevance_scores),
        "avg_faithfulness": average(faithfulness_scores),
        "judged_rows": len(relevance_scores),
    }


def print_summary(summary: dict, judges_on: bool) -> None:
    print()
    for category, category_counts in summary["per_category"].items():
        total = category_counts["ok"] + category_counts["failed"]
        print(f"{category:>12}: {category_counts['ok']}/{total} clean")
    if summary["counts"]["negative_cited"]:
        print(
            f"note: {summary['counts']['negative_cited']} negative row(s) cited "
            "known posts despite expecting none -- a prompt/retrieval gap, "
            "not an invented-citation failure."
        )
    if judges_on and summary["avg_relevance"] is not None:
        print(
            f"judged {summary['judged_rows']} rows: "
            f"avg relevance={summary['avg_relevance']:.3f} "
            f"avg faithfulness={summary['avg_faithfulness']:.3f}"
        )


def gate_regressions(
    summary: dict, min_relevance: float, min_faithfulness: float
) -> int:
    regressions = 0
    rel = summary["avg_relevance"]
    fai = summary["avg_faithfulness"]
    if rel is not None and rel < min_relevance:
        print(f"REGRESSION avg relevance={rel:.3f} < minimum {min_relevance}")
        regressions += 1
    if fai is not None and fai < min_faithfulness:
        print(f"REGRESSION avg faithfulness={fai:.3f} < minimum {min_faithfulness}")
        regressions += 1
    return regressions


# --- LangSmith experiment path ---


def chat_deterministic(inputs: dict, outputs: dict, reference_outputs: dict) -> dict:
    """LangSmith evaluator wrapping the deterministic checks."""
    problems = citation_problems(
        reference_outputs.get("category", "grounded"),
        reference_outputs.get("expected_post_ids", []),
        outputs.get("cited_post_ids", []),
    )
    return {"score": not problems, "comment": "; ".join(problems) or "ok"}


def _judge_feedback(score: float | None, raw: str) -> dict:
    if score is None:
        return {"score": 0.0, "comment": f"unparseable judge output: {raw[:200]}"}
    return {"score": score}


async def langsmith_relevance_judge(inputs: dict, outputs: dict) -> dict:
    raw = await judge_llm().generate_completion(
        EVAL_RELEVANCE_JUDGE_PROMPT,
        relevance_user_prompt(inputs["query"], outputs["answer"]),
    )
    return _judge_feedback(parse_judge_score(raw), raw)


async def langsmith_faithfulness_judge(inputs: dict, outputs: dict) -> dict:
    raw = await judge_llm().generate_completion(
        EVAL_FAITHFULNESS_JUDGE_PROMPT,
        faithfulness_user_prompt(
            inputs["query"],
            outputs["answer"],
            grounding_contexts(outputs.get("cited_post_ids", [])),
        ),
    )
    return _judge_feedback(parse_judge_score(raw), raw)


async def run_langsmith_experiment(
    stub: ai_service_pb2_grpc.AIServiceStub, judges_on: bool
) -> tuple[int, str]:
    """Run the suite through langsmith.aevaluate; returns (failures, name)."""
    try:
        from langsmith import aevaluate
    except ImportError as exc:  # pragma: no cover - depends on optional dep
        raise SystemExit("langsmith is not installed; run without --upload.") from exc

    evaluators: list = [chat_deterministic]
    if judges_on:
        evaluators += [langsmith_relevance_judge, langsmith_faithfulness_judge]

    results = await aevaluate(
        make_chat_target(stub),
        data=DATASET_NAME,
        evaluators=evaluators,
        experiment_prefix="chat-evals",
        max_concurrency=2,
    )

    failures = 0
    for row in results:
        for feedback in row["evaluation_results"].results:
            if feedback.key == "chat_deterministic" and not feedback.score:
                failures += 1
    return failures, results.experiment_name()
