import asyncio

import pytest

from src.llm import LLMError
from tests.fakes import FakeHTTPClient, FakeResponse, make_client, no_sleep, ok_response


async def test_generate_completion_returns_content(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = make_client(monkeypatch, FakeHTTPClient())

    assert await client.generate_completion("system", "user") == "hi"


async def test_generate_completion_sends_chat_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_http = FakeHTTPClient()
    client = make_client(monkeypatch, fake_http)

    await client.generate_completion("sys", "usr")

    assert fake_http.posted_payloads[0] == {
        "model": "lightning-ai/gpt-oss-20b",
        "messages": [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "usr"},
        ],
        "temperature": 0.7,
        "max_tokens": 2048,
    }


async def test_unexpected_response_shape_raises_llm_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_http = FakeHTTPClient(responses=[FakeResponse(200, {"unexpected": True})])
    client = make_client(monkeypatch, fake_http)

    with pytest.raises(LLMError):
        await client.generate_completion("sys", "usr")

    assert len(fake_http.posted_payloads) == 1


async def test_invalid_json_response_raises_llm_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_http = FakeHTTPClient(responses=[FakeResponse(200, {}, json_error=True)])
    client = make_client(monkeypatch, fake_http)

    with pytest.raises(LLMError):
        await client.generate_completion("sys", "usr")

    assert len(fake_http.posted_payloads) == 1


async def test_retries_transient_failures_then_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(asyncio, "sleep", no_sleep)
    fake_http = FakeHTTPClient(
        responses=[FakeResponse(500, {}), FakeResponse(500, {}), ok_response()]
    )
    client = make_client(monkeypatch, fake_http)

    assert await client.generate_completion("sys", "usr") == "hi"
    assert len(fake_http.posted_payloads) == 3


async def test_gives_up_after_max_attempts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(asyncio, "sleep", no_sleep)
    fake_http = FakeHTTPClient(
        responses=[FakeResponse(500, {}), FakeResponse(500, {}), FakeResponse(500, {})]
    )
    client = make_client(monkeypatch, fake_http)

    with pytest.raises(LLMError):
        await client.generate_completion("sys", "usr")

    assert len(fake_http.posted_payloads) == 3


async def test_429_respects_retry_after_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    slept: list[float] = []

    async def record_sleep(seconds: float) -> None:
        slept.append(seconds)

    monkeypatch.setattr(asyncio, "sleep", record_sleep)
    fake_http = FakeHTTPClient(
        responses=[
            FakeResponse(429, {}, headers={"Retry-After": "5"}),
            ok_response(),
        ]
    )
    client = make_client(monkeypatch, fake_http)

    assert await client.generate_completion("sys", "usr") == "hi"
    assert slept == [5.0]
    assert len(fake_http.posted_payloads) == 2


async def test_429_http_date_retry_after_falls_back_to_backoff(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    slept: list[float] = []

    async def record_sleep(seconds: float) -> None:
        slept.append(seconds)

    monkeypatch.setattr(asyncio, "sleep", record_sleep)
    fake_http = FakeHTTPClient(
        responses=[
            FakeResponse(
                429, {}, headers={"Retry-After": "Thu, 01 Oct 2026 00:00:00 GMT"}
            ),
            ok_response(),
        ]
    )
    client = make_client(monkeypatch, fake_http)

    assert await client.generate_completion("sys", "usr") == "hi"
    assert slept == [2.0]
    assert len(fake_http.posted_payloads) == 2


async def test_client_errors_not_retried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_http = FakeHTTPClient(responses=[FakeResponse(400, {})])
    client = make_client(monkeypatch, fake_http)

    with pytest.raises(LLMError):
        await client.generate_completion("sys", "usr")

    assert len(fake_http.posted_payloads) == 1


async def test_cancellation_not_retried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_http = FakeHTTPClient(error=asyncio.CancelledError())
    client = make_client(monkeypatch, fake_http)

    with pytest.raises(asyncio.CancelledError):
        await client.generate_completion("sys", "usr")

    assert len(fake_http.posted_payloads) == 1
