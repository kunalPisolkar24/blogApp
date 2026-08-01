import asyncio

import grpc
import pytest

from src import metrics
from src.generated import ai_service_pb2
from src.generated import ai_service_pb2_grpc as ai_stubs
from src.llm import LLMError
from tests.fakes import FakeHTTPClient, FakeResponse, make_client, no_sleep, ok_response


def _llm_counter(status: str) -> int:
    return metrics.LLM_REQUESTS.labels(status=status)._value.get()


def _grpc_counter(method: str, status: str) -> int:
    return metrics.GRPC_REQUESTS.labels(method=method, status=status)._value.get()


async def test_grpc_metrics_record_success_status(running_server, fake_llm) -> None:
    channel, _ = running_server
    stub = ai_stubs.AIServiceStub(channel)
    fake_llm.response = "sum"

    before = _grpc_counter("/ai.AIService/GenerateSummary", "OK")
    await stub.GenerateSummary(ai_service_pb2.ContentRequest(text="hello"))

    assert _grpc_counter("/ai.AIService/GenerateSummary", "OK") == before + 1


async def test_grpc_metrics_record_error_status(running_server, fake_llm) -> None:
    channel, _ = running_server
    stub = ai_stubs.AIServiceStub(channel)
    fake_llm.error = LLMError("boom")

    before = _grpc_counter("/ai.AIService/GenerateSummary", "UNAVAILABLE")
    with pytest.raises(grpc.aio.AioRpcError):
        await stub.GenerateSummary(ai_service_pb2.ContentRequest(text="hello"))

    assert _grpc_counter("/ai.AIService/GenerateSummary", "UNAVAILABLE") == before + 1


async def test_grpc_metrics_record_internal_status(running_server, fake_llm) -> None:
    channel, _ = running_server
    stub = ai_stubs.AIServiceStub(channel)
    fake_llm.response = "not json"

    before = _grpc_counter("/ai.AIService/GenerateTags", "INTERNAL")
    with pytest.raises(grpc.aio.AioRpcError):
        await stub.GenerateTags(ai_service_pb2.ContextRequest(title="t", body="b"))

    assert _grpc_counter("/ai.AIService/GenerateTags", "INTERNAL") == before + 1


async def test_grpc_metrics_record_invalid_argument(running_server, fake_llm) -> None:
    channel, _ = running_server
    stub = ai_stubs.AIServiceStub(channel)

    before = _grpc_counter("/ai.AIService/GenerateSummary", "INVALID_ARGUMENT")
    with pytest.raises(grpc.aio.AioRpcError):
        await stub.GenerateSummary(ai_service_pb2.ContentRequest(text="x" * 5001))

    assert (
        _grpc_counter("/ai.AIService/GenerateSummary", "INVALID_ARGUMENT") == before + 1
    )


async def test_metrics_llm_success_and_error(monkeypatch) -> None:
    success_before = _llm_counter("success")
    error_before = _llm_counter("error")

    client = make_client(monkeypatch, FakeHTTPClient(responses=[ok_response()]))
    await client.generate_completion("s", "u")

    assert _llm_counter("success") == success_before + 1
    assert _llm_counter("error") == error_before

    bad = make_client(monkeypatch, FakeHTTPClient(responses=[FakeResponse(400, {})]))
    with pytest.raises(LLMError):
        await bad.generate_completion("s", "u")

    assert _llm_counter("error") == error_before + 1


async def test_metrics_llm_retries_increment(monkeypatch) -> None:
    monkeypatch.setattr(asyncio, "sleep", no_sleep)
    before = metrics.LLM_RETRIES._value.get()
    client = make_client(
        monkeypatch, FakeHTTPClient(responses=[FakeResponse(500, {}), ok_response()])
    )

    await client.generate_completion("s", "u")

    assert metrics.LLM_RETRIES._value.get() == before + 1


async def test_metrics_llm_duration_observed(monkeypatch) -> None:
    from prometheus_client.registry import REGISTRY

    count_before = REGISTRY.get_sample_value("llm_request_duration_seconds_count")
    sum_before = REGISTRY.get_sample_value("llm_request_duration_seconds_sum")
    client = make_client(monkeypatch, FakeHTTPClient(responses=[ok_response()]))

    await client.generate_completion("s", "u")

    assert REGISTRY.get_sample_value("llm_request_duration_seconds_count") == (
        count_before + 1
    )
    assert REGISTRY.get_sample_value("llm_request_duration_seconds_sum") > sum_before
