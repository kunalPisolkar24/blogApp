"""Offline checks for the chat evaluators.

These run without Docker or a live service: they guard the deterministic
citation checks, the judge prompt assembly and score parsing, and the
streaming answer aggregation used by ``scripts/eval_chat.py``.
"""

from __future__ import annotations

from scripts.eval_chat import (
    EVAL_FAITHFULNESS_JUDGE_PROMPT,
    EVAL_RELEVANCE_JUDGE_PROMPT,
    _judge_feedback,
    chat_answer,
    citation_problems,
    faithfulness_user_prompt,
    grounding_contexts,
    judge_scores,
    make_chat_target,
    parse_judge_score,
    relevance_user_prompt,
)
from scripts.eval_data import CORPUS
from src.generated import ai_service_pb2

GROUNDED_ID = CORPUS[0]["post_id"]
OTHER_ID = CORPUS[1]["post_id"]
UNKNOWN_ID = "ffffffffffffffffffffffff"


# --- Deterministic checks ---


def test_grounded_row_with_all_expected_citations_is_clean() -> None:
    assert citation_problems("grounded", [GROUNDED_ID], [GROUNDED_ID, OTHER_ID]) == []


def test_grounded_row_missing_citation_fails() -> None:
    problems = citation_problems("grounded", [GROUNDED_ID, OTHER_ID], [GROUNDED_ID])
    assert len(problems) == 1
    assert str([OTHER_ID]) in problems[0]


def test_grounded_row_with_unknown_cited_id_fails() -> None:
    problems = citation_problems("grounded", [GROUNDED_ID], [GROUNDED_ID, UNKNOWN_ID])
    assert any(UNKNOWN_ID in problem for problem in problems)


def test_grounded_row_without_citations_fails() -> None:
    problems = citation_problems("grounded", [GROUNDED_ID], [])
    assert any("cited nothing" in problem for problem in problems)
    assert any("missing citations" in problem for problem in problems)


def test_negative_rows_must_cite_nothing() -> None:
    assert citation_problems("gibberish", [], []) == []
    assert citation_problems("out_of_scope", [], []) == []
    problems = citation_problems("gibberish", [], [GROUNDED_ID])
    assert problems == [f"expected no citations, got ['{GROUNDED_ID}']"]


def test_grounding_contexts_follow_corpus_order() -> None:
    contexts = grounding_contexts([OTHER_ID, GROUNDED_ID])
    assert contexts[0] == (CORPUS[1]["title"], CORPUS[1]["body"])
    assert contexts[1] == (CORPUS[0]["title"], CORPUS[0]["body"])


def test_grounding_contexts_skip_unknown_ids() -> None:
    assert grounding_contexts([UNKNOWN_ID]) == []


# --- Judge prompts and score parsing ---


def test_relevance_prompt_frames_question_and_answer() -> None:
    prompt = relevance_user_prompt("what stores posts?", "MongoDB does.")
    assert "what stores posts?" in prompt
    assert "MongoDB does." in prompt


def test_faithfulness_prompt_numbers_excerpts() -> None:
    prompt = faithfulness_user_prompt(
        "q", "answer", [("Title A", "Body A"), ("Title B", "Body B")]
    )
    assert "[1] Title A\nBody A" in prompt
    assert "[2] Title B\nBody B" in prompt


def test_faithfulness_prompt_handles_missing_excerpts() -> None:
    prompt = faithfulness_user_prompt("q", "cannot find anything", [])
    assert "(none)" in prompt


def test_parse_judge_score_reads_json_object() -> None:
    assert parse_judge_score('{"score": 0.9}') == 0.9


def test_parse_judge_score_survives_markdown_and_preamble() -> None:
    fenced = '```json\n{"score": 0.75}\n```'
    assert parse_judge_score(fenced) == 0.75
    preamble = 'Sure! {"score": 0.5} hope that helps'
    assert parse_judge_score(preamble) == 0.5


def test_parse_judge_score_clamps_to_unit_interval() -> None:
    assert parse_judge_score('{"score": 1.5}') == 1.0
    assert parse_judge_score('{"score": -0.2}') == 0.0


def test_parse_judge_score_returns_none_on_garbage() -> None:
    assert parse_judge_score("") is None
    assert parse_judge_score("no json here") is None
    assert parse_judge_score('{"confidence": 0.9}') is None
    assert parse_judge_score('{"score": "high"}') is None


async def test_judge_scores_calls_both_judges_and_parses() -> None:
    replies = iter(['{"score": 0.8}', '```json\n{"score": 0.6}\n```'])
    systems_seen: list[str] = []

    class ScriptedJudge:
        async def generate_completion(self, system: str, user: str) -> str:
            systems_seen.append(system)
            self.user = user
            return next(replies)

    relevance, faithfulness = await judge_scores(
        ScriptedJudge(), "query", "answer", [GROUNDED_ID]
    )
    assert (relevance, faithfulness) == (0.8, 0.6)
    assert systems_seen == [
        EVAL_RELEVANCE_JUDGE_PROMPT,
        EVAL_FAITHFULNESS_JUDGE_PROMPT,
    ]


# --- Live-stack helpers ---


class StubChatStream:
    """Minimal stub whose ChatAnswer yields canned chunks."""

    def __init__(self, chunks: list) -> None:
        self._chunks = chunks

    def ChatAnswer(self, request):
        self.request = request
        return iter(self._chunks)


async def test_chat_answer_joins_deltas_and_final_citations() -> None:
    stub = StubChatStream(
        [
            ai_service_pb2.ChatChunk(delta="Mongo"),
            ai_service_pb2.ChatChunk(delta="DB."),
            ai_service_pb2.ChatChunk(done=True, cited_post_ids=[GROUNDED_ID, OTHER_ID]),
        ]
    )
    answer, cited = await chat_answer(stub, "where are posts stored?", [])
    assert answer == "MongoDB."
    assert cited == [GROUNDED_ID, OTHER_ID]
    assert stub.request.query == "where are posts stored?"
    assert stub.request.top_k > 0


async def test_chat_target_maps_inputs_to_outputs() -> None:
    stub = StubChatStream(
        [
            ai_service_pb2.ChatChunk(delta="hi"),
            ai_service_pb2.ChatChunk(done=True, cited_post_ids=[GROUNDED_ID]),
        ]
    )
    target = make_chat_target(stub)
    outputs = await target(
        {
            "query": "q",
            "history": [{"role": "user", "content": "earlier"}],
        }
    )
    assert outputs == {"answer": "hi", "cited_post_ids": [GROUNDED_ID]}
    sent_history = stub.request.history
    assert [(m.role, m.content) for m in sent_history] == [("user", "earlier")]


# --- Judge feedback shape for LangSmith ---


def test_judge_feedback_wraps_unparseable_output() -> None:
    feedback = _judge_feedback(None, "garbage reply")
    assert feedback["score"] == 0.0
    assert "unparseable" in feedback["comment"]
    assert feedback["comment"].endswith("garbage reply")


def test_judge_feedback_passes_scores_through() -> None:
    assert _judge_feedback(0.42, '{"score": 0.42}') == {"score": 0.42}


# --- Sanity: prompts referenced by both judges exist ---


def test_evaluator_prompts_request_raw_json_scores() -> None:
    assert '"score"' in EVAL_RELEVANCE_JUDGE_PROMPT
    assert '"score"' in EVAL_FAITHFULNESS_JUDGE_PROMPT
