"""Offline checks for the curated chat evaluation dataset.

These run without Docker or a LangSmith account: they guard the dataset's
shape (size, valid expected citations, negative categories) and the pure
build helpers used by ``scripts/build_eval_dataset.py``.
"""

from __future__ import annotations

from pathlib import Path

from scripts.build_eval_dataset import (
    build_currated_examples,
    compute_example_id,
    write_local_file,
)
from scripts.eval_data import CORPUS, CURATED_QA, DATASET_NAME


def test_dataset_has_at_least_50_rows() -> None:
    assert len(CURATED_QA) >= 50


def test_every_expected_post_id_exists_in_corpus() -> None:
    corpus_ids = {post["post_id"] for post in CORPUS}
    for row in CURATED_QA:
        for post_id in row["expected_post_ids"]:
            assert post_id in corpus_ids, f"{row['id']} cites unknown {post_id}"


def test_categories_present_and_negatives_cite_nothing() -> None:
    categories = {row["category"] for row in CURATED_QA}
    assert {"grounded", "gibberish", "out_of_scope"} <= categories

    grounded = [r for r in CURATED_QA if r["category"] == "grounded"]
    assert grounded, "need at least one grounded row"
    assert all(r["expected_post_ids"] for r in grounded)

    negatives = [r for r in CURATED_QA if r["category"] != "grounded"]
    assert negatives, "need gibberish/out-of-scope negatives"
    assert all(r["expected_post_ids"] == [] for r in negatives)


def test_row_ids_are_unique() -> None:
    ids = [row["id"] for row in CURATED_QA]
    assert len(ids) == len(set(ids))


def test_build_currated_examples_is_stable_and_unique() -> None:
    examples = build_currated_examples()
    assert len(examples) == len(CURATED_QA)
    example_ids = [example["id"] for example in examples]
    assert len(example_ids) == len(set(example_ids))

    for example in examples:
        assert set(example) == {"id", "inputs", "outputs", "metadata"}
        assert example["inputs"]["query"]
        assert example["outputs"]["category"] in {
            "grounded",
            "gibberish",
            "out_of_scope",
        }
        assert example["metadata"]["source"] == "curated"


def test_example_id_is_deterministic() -> None:
    history = [{"role": "user", "content": "hi"}]
    first = compute_example_id("how does search work?", history, "grounded")
    second = compute_example_id("how does search work?", history, "grounded")
    assert first == second

    different = compute_example_id("how does caching work?", history, "grounded")
    assert different != first


def test_local_export_writes_parseable_jsonl(tmp_path: Path) -> None:
    examples = build_currated_examples()
    out = tmp_path / "eval_dataset.jsonl"
    written = write_local_file(examples, out)

    assert written.exists()
    lines = written.read_text(encoding="utf-8").splitlines()
    assert len(lines) == len(examples)
    for line in lines:
        row = __import__("json").loads(line)
        assert row["inputs"]["query"]
        assert "expected_post_ids" in row["outputs"]


def test_dataset_name_is_set() -> None:
    assert DATASET_NAME == "topos-chat-eval"
