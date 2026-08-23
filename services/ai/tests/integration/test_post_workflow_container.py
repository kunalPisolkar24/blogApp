"""Container test: the draft workflow survives a full service restart.

A draft generated against one served container must still be resumable
by a brand-new container pointed at the same Postgres checkpointer --
the whole point of parking the review gate in a checkpoint instead of
memory.
"""

from __future__ import annotations

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
