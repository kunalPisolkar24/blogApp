"""Offline checks for the post generation graph helpers."""

from __future__ import annotations

from src.graphs.post_graph import (
    DRAFT_THREAD_PREFIX,
    draft_edits_patch,
    draft_thread_id,
)


def test_draft_thread_ids_are_namespaced() -> None:
    assert draft_thread_id("abc123") == f"{DRAFT_THREAD_PREFIX}abc123"
    assert draft_thread_id("x") != draft_thread_id(f"{DRAFT_THREAD_PREFIX}x")


def test_draft_edits_patch_keeps_only_provided_fields() -> None:
    assert draft_edits_patch(None, None, None, []) == {}
    assert draft_edits_patch("T", None, None, []) == {"title": "T"}
    assert draft_edits_patch(None, "B", "S", ["a"]) == {
        "body": "B",
        "summary": "S",
        "tags": ["a"],
    }


def test_draft_edits_patch_empty_tags_do_not_clear_generated_tags() -> None:
    # An empty tags list means "no edit"; clearing tags entirely is not
    # a supported review operation.
    assert "tags" not in draft_edits_patch(None, None, None, [])
