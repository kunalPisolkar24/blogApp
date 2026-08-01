import json
import logging

import pytest
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from src.logging import setup_logging
from src.tracing import get_span_ids, setup_tracing


def test_setup_tracing_disabled_without_endpoint(
    monkeypatch: pytest.MonkeyPatch, caplog
) -> None:
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)

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
        trace_id, span_id = get_span_ids()
        assert trace_id == format(span.context.trace_id, "032x")
        assert span_id == format(span.context.span_id, "016x")


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

    assert record["trace_id"] == format(span.context.trace_id, "032x")
    assert record["span_id"] == format(span.context.span_id, "016x")


async def test_access_log_emitted_per_rpc(running_server, fake_llm, capsys) -> None:
    import json as jsonlib

    from src.generated import ai_service_pb2
    from src.generated import ai_service_pb2_grpc as ai_stubs

    setup_logging()
    channel, _ = running_server
    stub = ai_stubs.AIServiceStub(channel)
    fake_llm.response = "sum"

    await stub.GenerateSummary(ai_service_pb2.ContentRequest(text="hello"))

    records = [
        jsonlib.loads(line) for line in capsys.readouterr().out.strip().splitlines()
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
