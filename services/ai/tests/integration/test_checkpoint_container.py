import psycopg
import pytest
from grpc_health.v1 import health_pb2, health_pb2_grpc

pytestmark = pytest.mark.container

CHECKPOINT_TABLES = {"checkpoints", "checkpoint_blobs", "checkpoint_writes"}


def _public_tables(ai_postgres) -> set[str]:
    host = ai_postgres.get_container_host_ip()
    port = ai_postgres.get_exposed_port(5432)
    with psycopg.connect(
        "postgresql://ai_checkpointer:ai_checkpointer_pass@"
        f"{host}:{port}/ai_checkpoints",
        connect_timeout=5,
    ) as conn:
        rows = conn.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        ).fetchall()
    return {row[0] for row in rows}


def test_startup_creates_checkpoint_tables(checkpoint_service, ai_postgres) -> None:
    # Reaching SERVING means startup ran checkpointer.setup() against the
    # real database; verify the tables it creates exist.
    assert CHECKPOINT_TABLES <= _public_tables(ai_postgres)


def test_setup_is_idempotent_on_existing_tables(
    start_service, ai_postgres, checkpoint_service
) -> None:
    # A second service against the same database must come up healthy,
    # proving setup() re-runs cleanly over existing tables.
    second = start_service(
        {
            "CHECKPOINT_DB_URL": (
                "postgresql://ai_checkpointer:ai_checkpointer_pass@"
                "ai-postgres:5432/ai_checkpoints"
            )
        }
    )
    try:
        stub = health_pb2_grpc.HealthStub(second.channel)
        response = stub.Check(health_pb2.HealthCheckRequest(service="ai.AIService"))
        assert response.status == health_pb2.HealthCheckResponse.SERVING
        assert CHECKPOINT_TABLES <= _public_tables(ai_postgres)
    finally:
        second.stop()
