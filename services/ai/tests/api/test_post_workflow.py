"""End-to-end draft workflow tests over an in-process gRPC server.

These cover the human-in-the-loop cycle from #164 with the fake LLM:
generate pauses at pending, approve resumes to a final payload (with
optional edits), reject records a rejection yet keeps the workflow
resumable, and repeat approvals are idempotent.
"""

from __future__ import annotations

import json

import grpc
import pytest
from langgraph.checkpoint.memory import InMemorySaver
from qdrant_client import AsyncQdrantClient

from src.api.server import create_server
from src.api.service import AIService
from src.config import settings
from src.embeddings import FakeEmbeddingClient
from src.generated import ai_service_pb2 as pb
from src.generated import ai_service_pb2_grpc as ai_stubs
from src.graphs.post_graph import build_post_generation_graph
from src.vector import SearchIndex
from tests.fake_llm import FakeLLM

DRAFT_JSON = json.dumps(
    {
        "title": "Draft title",
        "body": "<h2>Intro</h2><p>Hello there.</p>",
        "summary": "A generated summary.",
        "tags": ["generated", "draft"],
    }
)


@pytest.fixture
def post_llm() -> FakeLLM:
    return FakeLLM(response=DRAFT_JSON)


@pytest.fixture
async def workflow_server(unused_tcp_port: int, post_llm: FakeLLM):
    index = SearchIndex(FakeEmbeddingClient(), AsyncQdrantClient(location=":memory:"))
    await index.ensure_collection()
    graph = build_post_generation_graph(post_llm, checkpointer=InMemorySaver())
    server, _ = await create_server(
        AIService(post_llm, index, FakeEmbeddingClient(), post_generation_graph=graph),
        str(unused_tcp_port),
    )
    await server.start()
    channel = grpc.aio.insecure_channel(f"127.0.0.1:{unused_tcp_port}")
    await channel.channel_ready()

    yield channel, server

    await channel.close()
    await server.stop(grace=None)


@pytest.fixture
def workflow_stub(workflow_server) -> ai_stubs.AIServiceStub:
    channel, _ = workflow_server
    return ai_stubs.AIServiceStub(channel)


async def _generate_draft(stub) -> pb.PostWorkflowState:
    return await stub.GeneratePostDraft(pb.PostGenerationRequest(prompt="a topic"))


# --- Generation pauses at the review gate ---


async def test_generate_draft_returns_pending_payload(workflow_stub) -> None:
    draft = await _generate_draft(workflow_stub)
    assert draft.status == pb.WORKFLOW_STATUS_PENDING
    assert draft.title == "Draft title"
    assert draft.body.startswith("<h2>")
    assert list(draft.tags) == ["generated", "draft"]
    assert len(draft.approval_id) == 32


async def test_generate_draft_validates_prompt(workflow_stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as empty:
        await workflow_stub.GeneratePostDraft(pb.PostGenerationRequest(prompt="   "))
    assert empty.value.code() == grpc.StatusCode.INVALID_ARGUMENT

    with pytest.raises(grpc.aio.AioRpcError) as large:
        await workflow_stub.GeneratePostDraft(
            pb.PostGenerationRequest(prompt="x" * (settings.MAX_POST_CHARS + 1))
        )
    assert large.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_unknown_approval_id_is_not_found(workflow_stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as approve_err:
        await workflow_stub.ApprovePost(pb.ApprovePostRequest(approval_id="missing"))
    assert approve_err.value.code() == grpc.StatusCode.NOT_FOUND

    with pytest.raises(grpc.aio.AioRpcError) as reject_err:
        await workflow_stub.RejectPost(pb.RejectPostRequest(approval_id="missing"))
    assert reject_err.value.code() == grpc.StatusCode.NOT_FOUND


# --- Approval resumes the workflow ---


async def test_approve_resumes_to_final_payload(workflow_stub) -> None:
    draft = await _generate_draft(workflow_stub)

    approved = await workflow_stub.ApprovePost(
        pb.ApprovePostRequest(approval_id=draft.approval_id)
    )
    assert approved.status == pb.WORKFLOW_STATUS_APPROVED
    assert approved.title == "Draft title"
    assert approved.approval_id == draft.approval_id


async def test_approve_applies_edits_before_resume(workflow_stub) -> None:
    draft = await _generate_draft(workflow_stub)

    approved = await workflow_stub.ApprovePost(
        pb.ApprovePostRequest(
            approval_id=draft.approval_id,
            title="Edited title",
            summary="Edited summary.",
            tags=["reviewer", "pick"],
        )
    )
    assert approved.status == pb.WORKFLOW_STATUS_APPROVED
    assert approved.title == "Edited title"
    assert approved.summary == "Edited summary."
    assert approved.body == draft.body  # untouched field keeps the draft value
    assert list(approved.tags) == ["reviewer", "pick"]


async def test_repeat_approve_is_idempotent(workflow_stub) -> None:
    draft = await _generate_draft(workflow_stub)

    first = await workflow_stub.ApprovePost(
        pb.ApprovePostRequest(approval_id=draft.approval_id)
    )
    second = await workflow_stub.ApprovePost(
        pb.ApprovePostRequest(approval_id=draft.approval_id, title="Too late edit")
    )
    assert second.status == pb.WORKFLOW_STATUS_APPROVED
    assert second.title == first.title == "Draft title"


# --- Rejection stays resumable ---


async def test_reject_records_rejection_and_allows_later_approval(
    workflow_stub,
) -> None:
    draft = await _generate_draft(workflow_stub)

    rejected = await workflow_stub.RejectPost(
        pb.RejectPostRequest(approval_id=draft.approval_id, reason="needs work")
    )
    assert rejected.status == pb.WORKFLOW_STATUS_REJECTED
    assert rejected.approval_id == draft.approval_id

    repeat = await workflow_stub.RejectPost(
        pb.RejectPostRequest(approval_id=draft.approval_id)
    )
    assert repeat.status == pb.WORKFLOW_STATUS_REJECTED

    approved = await workflow_stub.ApprovePost(
        pb.ApprovePostRequest(approval_id=draft.approval_id)
    )
    assert approved.status == pb.WORKFLOW_STATUS_APPROVED
