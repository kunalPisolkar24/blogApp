import json
from typing import Any

import grpc
import pytest
from grpc_health.v1 import health_pb2, health_pb2_grpc

from src.generated import ai_service_pb2
from src.llm import LLMError
from src.logging import setup_logging
from tests.fake_llm import FakeLLM


async def test_generate_summary(stub, fake_llm: FakeLLM) -> None:
    fake_llm.response = "A short summary."

    response = await stub.GenerateSummary(ai_service_pb2.ContentRequest(text="hello"))

    assert response.summary == "A short summary."
    assert fake_llm.calls[0][1] == "hello"


async def test_generate_summary_skips_empty_text(stub, fake_llm: FakeLLM) -> None:
    response = await stub.GenerateSummary(ai_service_pb2.ContentRequest(text="  "))

    assert response.summary == ""
    assert fake_llm.calls == []


async def test_generate_summary_cleans_html(stub, fake_llm: FakeLLM) -> None:
    fake_llm.response = "sum"

    await stub.GenerateSummary(
        ai_service_pb2.ContentRequest(text="<p>Hello <strong>world</strong></p>")
    )

    assert fake_llm.calls[0][1] == "Hello world"


async def test_generate_summary_too_long_rejected(stub, fake_llm: FakeLLM) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.GenerateSummary(ai_service_pb2.ContentRequest(text="x" * 5001))

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert fake_llm.calls == []


async def test_generate_tags_fenced_json(stub, fake_llm: FakeLLM) -> None:
    fake_llm.response = '```json\n["ai", "tech"]\n```'

    response = await stub.GenerateTags(
        ai_service_pb2.ContextRequest(title="t", body="b")
    )

    assert list(response.tags) == ["ai", "tech"]


async def test_generate_tags_plain_json(stub, fake_llm: FakeLLM) -> None:
    fake_llm.response = '["ai", "tech"]'

    response = await stub.GenerateTags(
        ai_service_pb2.ContextRequest(title="t", body="b")
    )

    assert list(response.tags) == ["ai", "tech"]


async def test_generate_tags_object_form(stub, fake_llm: FakeLLM) -> None:
    fake_llm.response = '{"tags": ["ai", "tech"]}'

    response = await stub.GenerateTags(
        ai_service_pb2.ContextRequest(title="t", body="b")
    )

    assert list(response.tags) == ["ai", "tech"]


async def test_generate_tags_filters_non_strings(stub, fake_llm: FakeLLM) -> None:
    fake_llm.response = '["ai", 42, "tech"]'

    response = await stub.GenerateTags(
        ai_service_pb2.ContextRequest(title="t", body="b")
    )

    assert list(response.tags) == ["ai", "tech"]


async def test_generate_tags_invalid_json(stub, fake_llm: FakeLLM) -> None:
    fake_llm.response = "not json at all"

    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.GenerateTags(ai_service_pb2.ContextRequest(title="t", body="b"))

    assert exc_info.value.code() == grpc.StatusCode.INTERNAL


async def test_generate_post(stub, fake_llm: FakeLLM) -> None:
    fake_llm.response = json.dumps(
        {
            "title": "My Post",
            "body": "<p>content</p>",
            "summary": "short",
            "tags": ["ai"],
        }
    )

    response = await stub.GeneratePost(
        ai_service_pb2.PostGenerationRequest(prompt="topic")
    )

    assert response.title == "My Post"
    assert response.body == "<p>content</p>"
    assert response.summary == "short"
    assert list(response.tags) == ["ai"]
    assert "topic" in fake_llm.calls[0][1]


async def test_generate_post_sanitizes_body(stub, fake_llm: FakeLLM) -> None:
    fake_llm.response = json.dumps(
        {
            "title": "My Post",
            "body": "<p>ok</p><script>alert(1)</script>",
            "summary": "short",
            "tags": ["ai"],
        }
    )

    response = await stub.GeneratePost(
        ai_service_pb2.PostGenerationRequest(prompt="topic")
    )

    assert "<script" not in response.body
    assert response.body.startswith("<p>ok</p>")


async def test_generate_post_invalid_schema(stub, fake_llm: FakeLLM) -> None:
    fake_llm.response = '{"title": "missing fields"}'

    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.GeneratePost(ai_service_pb2.PostGenerationRequest(prompt="topic"))

    assert exc_info.value.code() == grpc.StatusCode.INTERNAL


async def test_generate_post_too_long_rejected(stub, fake_llm: FakeLLM) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.GeneratePost(ai_service_pb2.PostGenerationRequest(prompt="x" * 5001))

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert fake_llm.calls == []


async def test_generate_tags_truncates_long_body(stub, fake_llm: FakeLLM) -> None:
    fake_llm.response = '["ai"]'
    long_body = "a" * 5000

    await stub.GenerateTags(ai_service_pb2.ContextRequest(title="t", body=long_body))

    assert fake_llm.calls[0][1] == f"Title: t\nBody: {'a' * 3000}"


async def test_generate_tags_truncates_long_title(stub, fake_llm: FakeLLM) -> None:
    fake_llm.response = '["ai"]'

    await stub.GenerateTags(ai_service_pb2.ContextRequest(title="x" * 5000, body="b"))

    assert fake_llm.calls[0][1] == f"Title: {'x' * 200}\nBody: b"


async def test_generate_tags_cleans_html_body(stub, fake_llm: FakeLLM) -> None:
    fake_llm.response = '["ai"]'

    await stub.GenerateTags(
        ai_service_pb2.ContextRequest(title="t", body="<h1>Hello</h1><p>world</p>")
    )

    assert fake_llm.calls[0][1] == "Title: t\nBody: Hello world"


async def test_generate_tags_too_long_rejected(stub, fake_llm: FakeLLM) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.GenerateTags(
            ai_service_pb2.ContextRequest(title="t", body="x" * 5001)
        )

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert fake_llm.calls == []


@pytest.mark.parametrize("method", ["GenerateSummary", "GenerateTags", "GeneratePost"])
async def test_llm_error_maps_to_unavailable(
    stub, fake_llm: FakeLLM, method: str
) -> None:
    fake_llm.error = LLMError("boom")

    callable_rpc = getattr(stub, method)
    request = {
        "GenerateSummary": ai_service_pb2.ContentRequest(text="hello"),
        "GenerateTags": ai_service_pb2.ContextRequest(title="t", body="b"),
        "GeneratePost": ai_service_pb2.PostGenerationRequest(prompt="topic"),
    }[method]

    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await callable_rpc(request)

    assert exc_info.value.code() == grpc.StatusCode.UNAVAILABLE


def _log_records(capsys) -> list[dict]:
    return [json.loads(line) for line in capsys.readouterr().out.strip().splitlines()]


async def test_llm_error_logged_with_stacktrace(
    stub, fake_llm: FakeLLM, capsys
) -> None:
    setup_logging()
    fake_llm.error = LLMError("boom")

    with pytest.raises(grpc.aio.AioRpcError):
        await stub.GenerateSummary(ai_service_pb2.ContentRequest(text="hello"))

    record = next(
        r for r in _log_records(capsys) if r.get("message") == "LLM provider failed"
    )
    assert record["level"] == "ERROR"
    assert "LLMError" in record["stacktrace"]
    assert "boom" in record["stacktrace"]


async def test_unexpected_error_logged_with_stacktrace(
    stub, fake_llm: FakeLLM, capsys
) -> None:
    setup_logging()
    fake_llm.response = "not json"

    with pytest.raises(grpc.aio.AioRpcError):
        await stub.GenerateTags(ai_service_pb2.ContextRequest(title="t", body="b"))

    record = next(
        r
        for r in _log_records(capsys)
        if r.get("message") == "unexpected error in GenerateTags"
    )
    assert record["level"] == "ERROR"
    assert "JSONDecodeError" in record["stacktrace"]


async def test_ai_service_health_serving(running_server) -> None:
    channel, _ = running_server
    stub: Any = health_pb2_grpc.HealthStub(channel)

    response = await stub.Check(health_pb2.HealthCheckRequest(service="ai.AIService"))

    assert response.status == health_pb2.HealthCheckResponse.SERVING
