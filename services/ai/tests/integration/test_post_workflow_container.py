"""Container tests: the draft workflow survives restarts and races.

A draft generated against one served container must still be resumable
by a brand-new container pointed at the same Postgres checkpointer --
the whole point of parking the review gate in a checkpoint instead of
memory. Concurrent approvals must also resolve to a single outcome.
"""

from __future__ import annotations

import concurrent.futures

import grpc
import pytest

from src.generated import ai_service_pb2 as pb

pytestmark = pytest.mark.container

RESTART_ENV = {
    "CHECKPOINT_DB_URL": (
        "postgresql://ai_checkpointer:ai_checkpointer_pass@"
        "ai-postgres:5432/ai_checkpoints"
    )
}


def test_draft_survives_service_restart(start_service, ai_postgres) -> None:
    """Generate against a live service, replace it, approve via the new one."""
    first = start_service(RESTART_ENV)
    draft = first.stub.GeneratePostDraft(
        pb.PostGenerationRequest(prompt="write about qdrant")
    )
    assert draft.status == pb.WORKFLOW_STATUS_PENDING
    first.stop()

    # Simulate a process crash/redeploy: the first container is gone; a
    # fresh one on the same database must still resume the workflow.
    restarted = start_service(RESTART_ENV)
    try:
        approved = restarted.stub.ApprovePost(
            pb.ApprovePostRequest(approval_id=draft.approval_id)
        )
        assert approved.status == pb.WORKFLOW_STATUS_APPROVED
        assert approved.title == draft.title
        assert approved.approval_id == draft.approval_id

        # The resumed workflow is terminal: repeat approvals are no-ops.
        repeat = restarted.stub.ApprovePost(
            pb.ApprovePostRequest(approval_id=draft.approval_id)
        )
        assert repeat.status == pb.WORKFLOW_STATUS_APPROVED
        assert repeat.title == approved.title
    finally:
        restarted.stop()


def test_reject_then_reapprove_across_restart(start_service, ai_postgres) -> None:
    """Rejections persist too, and a later approval still goes through."""
    first = start_service(RESTART_ENV)
    try:
        draft = first.stub.GeneratePostDraft(
            pb.PostGenerationRequest(prompt="write about kafka")
        )
        rejected = first.stub.RejectPost(
            pb.RejectPostRequest(approval_id=draft.approval_id, reason="not yet")
        )
        assert rejected.status == pb.WORKFLOW_STATUS_REJECTED
    finally:
        first.stop()

    second = start_service(RESTART_ENV)
    try:
        # Sanity: the fresh instance maps unknown ids to NOT_FOUND...
        with pytest.raises(grpc.RpcError) as missing:
            second.stub.ApprovePost(pb.ApprovePostRequest(approval_id="0" * 32))
        assert missing.value.code() == grpc.StatusCode.NOT_FOUND

        # ...and the persisted rejection still resumes into approval.
        approved = second.stub.ApprovePost(
            pb.ApprovePostRequest(approval_id=draft.approval_id)
        )
        assert approved.status == pb.WORKFLOW_STATUS_APPROVED
    finally:
        second.stop()


def test_concurrent_approvals_resolve_to_one_outcome(
    start_service, ai_postgres
) -> None:
    """Two simultaneous approvals both succeed with the same payload.

    The AI side is idempotent by design; whichever call resumes the
    checkpoint first wins, and the loser's repeat-approve pre-check
    returns the stored result. Publication-level exclusivity is proven
    at the content layer.
    """
    service = start_service(RESTART_ENV)
    try:
        draft = service.stub.GeneratePostDraft(
            pb.PostGenerationRequest(prompt="write about concurrency")
        )

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(
                    service.stub.ApprovePost,
                    pb.ApprovePostRequest(approval_id=draft.approval_id),
                )
                for _ in range(2)
            ]
            results = [future.result(timeout=30) for future in futures]

        assert all(r.status == pb.WORKFLOW_STATUS_APPROVED for r in results)
        assert results[0].title == results[1].title
        assert results[0].approval_id == draft.approval_id
    finally:
        service.stop()
