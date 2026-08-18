import json
import logging

import grpc
import pytest
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from src.config import settings
from src.generated import ai_service_pb2
from src.generated import ai_service_pb2_grpc as ai_stubs
from src.observability.logging import setup_logging
from src.observability.tracing import get_span_ids, setup_tracing


def test_setup_tracing_disabled_without_endpoint(
    monkeypatch: pytest.MonkeyPatch, caplog
) -> None:
    monkeypatch.setattr(settings, "OTEL_EXPORTER_OTLP_ENDPOINT", "")

    with caplog.at_level(logging.INFO):
        setup_tracing()

    assert "tracing disabled" in caplog.text


def test_get_span_ids_none_without_span() -> None:
    assert get_span_ids() is None


def test_get_span_ids_inside_active_span() -> None:
    exporter = InMemorySpanExporter()
    provider = TracerProvider(resource=Resource.create({"service.name": "test"}))
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    span = trace.get_tracer("test").start_span("op")
    with trace.use_span(span, end_on_exit=True):
        trace_ids = get_span_ids()
        assert trace_ids is not None
        trace_id, span_id = trace_ids
        assert trace_id == format(span.get_span_context().trace_id, "032x")
        assert span_id == format(span.get_span_context().span_id, "016x")


def test_log_record_includes_trace_ids_inside_span(capsys) -> None:
    setup_logging()
    exporter = InMemorySpanExporter()
    provider = TracerProvider(resource=Resource.create({"service.name": "test"}))
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    span = trace.get_tracer("test").start_span("op")
    with trace.use_span(span, end_on_exit=True):
        logging.getLogger("test.module").info("hello")

    records = [
        json.loads(line) for line in capsys.readouterr().out.strip().splitlines()
    ]
    record = next(r for r in records if r.get("message") == "hello")

    assert record["trace_id"] == format(span.get_span_context().trace_id, "032x")
    assert record["span_id"] == format(span.get_span_context().span_id, "016x")


async def test_access_log_emitted_per_rpc(running_server, fake_llm, capsys) -> None:
    setup_logging()
    channel, _ = running_server
    stub = ai_stubs.AIServiceStub(channel)
    fake_llm.response = "sum"

    await stub.GenerateSummary(ai_service_pb2.ContentRequest(text="hello"))

    records = [
        json.loads(line) for line in capsys.readouterr().out.strip().splitlines()
    ]
    access = None
    for record in records:
        if record.get("logger") == "access":
            access = record
            break
    assert access is not None
    assert access["message"] == "rpc completed"
    assert access["method"] == "/ai.AIService/GenerateSummary"
    assert access["status"] == "OK"
    assert access["duration_ms"] >= 0
    assert access["trace_id"] == "-"
    assert access["span_id"] == "-"


def _access_records(capsys) -> list[dict]:
    records = [
        json.loads(line) for line in capsys.readouterr().out.strip().splitlines()
    ]
    return [record for record in records if record.get("logger") == "access"]


async def test_access_log_carries_recommend_fields(running_server, capsys) -> None:
    setup_logging()
    channel, _ = running_server
    stub = ai_stubs.AIServiceStub(channel)

    await stub.RecommendFeed(
        ai_service_pb2.RecommendRequest(
            user_id="user-1", mode=ai_service_pb2.RECOMMEND_MODE_SURPRISE
        )
    )

    access = next(
        r
        for r in _access_records(capsys)
        if r.get("method") == "/ai.AIService/RecommendFeed"
    )
    assert access["mode"] == "surprise"
    assert access["result_count"] == 0
    assert access["total"] == 0


async def test_access_log_carries_profile_kind(running_server, capsys) -> None:
    setup_logging()
    channel, _ = running_server
    stub = ai_stubs.AIServiceStub(channel)

    await stub.UpdateUserProfile(
        ai_service_pb2.UserProfileUpdateRequest(
            user_id="user-1",
            post_id="6a75a41221a9752ec47bc6df",
            kind=ai_service_pb2.INTERACTION_KIND_LIKE,
        )
    )

    access = next(
        r
        for r in _access_records(capsys)
        if r.get("method") == "/ai.AIService/UpdateUserProfile"
    )
    assert access["kind"] == "like"


async def test_access_log_omits_request_fields_on_error(running_server, capsys) -> None:
    setup_logging()
    channel, _ = running_server
    stub = ai_stubs.AIServiceStub(channel)

    with pytest.raises(grpc.aio.AioRpcError):
        await stub.RecommendFeed(ai_service_pb2.RecommendRequest(user_id=""))

    access = next(
        r
        for r in _access_records(capsys)
        if r.get("method") == "/ai.AIService/RecommendFeed"
    )
    assert access["status"] == "INVALID_ARGUMENT"
    assert "mode" not in access
    assert "result_count" not in access
    assert "total" not in access
