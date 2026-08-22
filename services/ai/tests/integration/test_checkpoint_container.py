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


async def test_sessions_resume_through_postgres_factory(
    monkeypatch: pytest.MonkeyPatch, ai_postgres
) -> None:
    """Two turns on one thread persist across independent checkpointer
    instances: turn 2 runs on a brand-new saver built by the production
    factory against the same Postgres, simulating a service restart."""
    from langgraph.checkpoint.memory import InMemorySaver

    from src.config import settings
    from src.graphs.chat_graph import build_chat_graph, graph_config_for
    from src.graphs.checkpointer import (
        build_checkpointer,
        close_checkpointer,
        start_checkpointer,
    )
    from src.llm import FakeLLMClient
    from src.vector import SearchResult

    class StubEmbeddings:
        async def embed(self, texts: list[str]) -> list[list[float]]:
            return [[0.1] * 4 for _ in texts]

    class StubStore:
        async def retrieve_by_vector(self, vector: list[float], top_k: int):
            return []

        async def search(self, query: str, offset: int, limit: int):
            return SearchResult(post_ids=[], total=0)

        async def get_posts(self, post_ids: list[str]):
            return []

    host = ai_postgres.get_container_host_ip()
    port = ai_postgres.get_exposed_port(5432)
    original_url = settings.CHECKPOINT_DB_URL
    settings.CHECKPOINT_DB_URL = (
        f"postgresql://ai_checkpointer:ai_checkpointer_pass@{host}:{port}/"
        "ai_checkpoints"
    )

    async def run_turn(query: str, thread_id: str) -> list:
        saver = build_checkpointer()
        assert not isinstance(saver, InMemorySaver)
        try:
            await start_checkpointer(saver)
            graph = build_chat_graph(
                FakeLLMClient(), StubStore(), StubEmbeddings(), checkpointer=saver
            )
            result = await graph.ainvoke(
                {"query": query, "top_k": 1}, graph_config_for(thread_id)
            )
        finally:
            await close_checkpointer(saver)
        return [m.content for m in result["messages"] if m.role == "user"]

    try:
        first = await run_turn("first question", thread_id="chat-resume")
        # Fresh saver instance: proves durability, not just in-memory state.
        second = await run_turn("second question", thread_id="chat-resume")
        other = await run_turn("unrelated", thread_id="chat-other")
    finally:
        settings.CHECKPOINT_DB_URL = original_url

    assert first == ["first question"]
    assert second == ["first question", "second question"]
    assert other == ["unrelated"]
