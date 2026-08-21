#!/usr/bin/env python3
"""Build and version the Topos chat evaluation dataset.

The dataset has two sources, merged into one versioned artifact:

1. Curated Q&A (always) -- authored in ``scripts/eval_data.py``: ~50
   questions about the platform with expected cited post ids, plus
   gibberish and out-of-scope negatives that should cite nothing.
2. Real chat traces (optional) -- if ``LANGSMITH_PROJECT`` is set, runs from
   that LangSmith project are converted into examples. This is best-effort:
   traces that cannot be mapped to a (query -> cited ids) pair are skipped, so
   the curated set alone still satisfies the dataset size requirement.

Outputs
-------
* A local JSONL file (always written) so the dataset is reproducible without a
  LangSmith account. Rows are one JSON object per line.
* A LangSmith dataset (only when ``LANGSMITH_API_KEY`` is present and
  ``--local-only`` is not passed). Example ids are deterministic, so re-running
  the script is idempotent: it upserts the same rows rather than duplicating.

Usage
-----
    # Write the local artifact only (default when no API key is set):
    poetry run python scripts/build_eval_dataset.py

    # Force the local artifact even if a key is present:
    poetry run python scripts/build_eval_dataset.py --local-only

    # Also upload to LangSmith (needs LANGSMITH_API_KEY):
    poetry run python scripts/build_eval_dataset.py --upload
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from eval_data import CORPUS, CURATED_QA, DATASET_NAME

CORPUS_IDS = {post["post_id"] for post in CORPUS}


def compute_example_id(query: str, history: list[dict], category: str) -> str:
    """Stable id for an example so re-runs upsert instead of duplicating."""
    payload = json.dumps(
        {"query": query, "history": history, "category": category},
        sort_keys=True,
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]


def _history_as_dicts(history: list[tuple[str, str]]) -> list[dict]:
    return [{"role": role, "content": content} for role, content in history]


def build_currated_examples() -> list[dict]:
    """Turn the authored Q&A rows into LangSmith-style example dicts."""
    examples: list[dict] = []
    for row in CURATED_QA:
        history = _history_as_dicts(row.get("history", []))
        examples.append(
            {
                "id": compute_example_id(row["query"], history, row["category"]),
                "inputs": {"query": row["query"], "history": history},
                "outputs": {
                    "expected_post_ids": row["expected_post_ids"],
                    "category": row["category"],
                },
                "metadata": {
                    "source": "curated",
                    "category": row["category"],
                    "corpus_size": len(CORPUS),
                },
            }
        )
    return examples


def pull_trace_examples(client, project: str, limit: int) -> list[dict]:
    """Convert LangSmith chat runs into examples. Best-effort and additive.

    Only runs that expose a query (in inputs) and cited post ids (in outputs
    or metadata) become examples; everything else is skipped so a partial or
    empty trace history never breaks the build.
    """
    examples: list[dict] = []
    try:
        runs = client.list_runs(project_name=project, limit=limit)
    except Exception as exc:  # noqa: BLE001 - tracing must never block the build
        print(f"  skipping trace pull: {exc}")
        return examples

    for run in runs:
        inputs = run.inputs or {}
        query = inputs.get("query")
        if not query:
            continue
        history = _history_as_dicts(inputs.get("history", []) or [])
        outputs = run.outputs or {}
        cited = outputs.get("cited_post_ids") or (run.metadata or {}).get(
            "cited_post_ids"
        )
        if cited is None:
            continue
        category = (run.metadata or {}).get("category", "grounded")
        examples.append(
            {
                "id": compute_example_id(query, history, f"trace-{category}"),
                "inputs": {"query": query, "history": history},
                "outputs": {
                    "expected_post_ids": list(cited),
                    "category": category,
                },
                "metadata": {
                    "source": "langsmith",
                    "category": category,
                    "corpus_size": len(CORPUS),
                    "run_id": str(run.id),
                },
            }
        )
    return examples


def write_local_file(rows: list[dict], path: Path) -> Path:
    """Write one JSON object per line. Overwrites so runs are reproducible."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    return path


def upload_to_langsmith(rows: list[dict], dataset_name: str) -> None:
    """Create (or reuse) the dataset and idempotently upsert the examples."""
    try:
        from langsmith import Client
    except ImportError as exc:  # pragma: no cover - depends on optional dep
        raise SystemExit(
            "langsmith is not installed. Add it with "
            "`poetry add langsmith`, or run with --local-only."
        ) from exc

    api_key = os.environ.get("LANGSMITH_API_KEY")
    if not api_key:
        raise SystemExit(
            "LANGSMITH_API_KEY is not set; pass --local-only to skip upload."
        )

    client = Client()
    dataset = client.get_or_create_dataset(
        dataset_name=dataset_name,
        description=(
            "Topos grounded chat evaluation dataset: curated Q&A with expected "
            "cited post ids, plus gibberish and out-of-scope negatives."
        ),
    )
    client.upsert_examples(examples=rows, dataset_id=dataset.id)
    print(f"  uploaded {len(rows)} examples to LangSmith dataset '{dataset_name}'")


def _summarize(rows: list[dict]) -> str:
    by_category: dict[str, int] = {}
    for row in rows:
        by_category[row["metadata"]["category"]] = (
            by_category.get(row["metadata"]["category"], 0) + 1
        )
    parts = ", ".join(f"{count} {name}" for name, count in sorted(by_category.items()))
    return f"{len(rows)} rows ({parts})"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--local-only",
        action="store_true",
        help="write only the local JSONL artifact and skip LangSmith upload",
    )
    parser.add_argument(
        "--upload",
        action="store_true",
        help="upload to LangSmith even if no key is needed; requires LANGSMITH_API_KEY",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("eval_dataset.jsonl"),
        help="path for the local JSONL artifact (default: ./eval_dataset.jsonl)",
    )
    parser.add_argument(
        "--project",
        default=os.environ.get("LANGSMITH_PROJECT"),
        help="LangSmith project to pull real chat traces from (default: $LANGSMITH_PROJECT)",
    )
    parser.add_argument(
        "--trace-limit",
        type=int,
        default=200,
        help="max number of trace runs to pull (default: 200)",
    )
    args = parser.parse_args(argv)

    print(f"Building dataset '{DATASET_NAME}'...")
    rows = build_currated_examples()
    print(f"  curated: {_summarize(rows)}")

    if args.project and not (args.local_only and not args.upload):
        try:
            from langsmith import Client
        except ImportError:
            print("  langsmith not installed; skipping trace pull")
        else:
            trace_rows = pull_trace_examples(Client(), args.project, args.trace_limit)
            if trace_rows:
                rows = rows + trace_rows
                print(f"  with traces: {_summarize(rows)}")

    written = write_local_file(rows, args.output)
    print(f"  wrote local artifact: {written}")

    should_upload = args.upload and not args.local_only
    if should_upload:
        upload_to_langsmith(rows, DATASET_NAME)
    else:
        print(
            "  LangSmith upload skipped (use --upload with LANGSMITH_API_KEY, "
            "or set LANGSMITH_API_KEY to enable it by default)."
        )

    print(f"Dataset ready: {_summarize(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
