import asyncio

import httpx
import pytest

from src.llm import LLMClient, LLMError


class FakeResponse:
    def __init__(
        self, status_code: int, body: dict, headers: dict | None = None
    ) -> None:
        self.status_code = status_code
        self.headers = headers or {}
        self._body = body

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("POST", "http://example.com")
            response = httpx.Response(
                self.status_code, request=request, headers=self.headers
            )
            raise httpx.HTTPStatusError("boom", request=request, response=response)

    def json(self) -> dict:
        return self._body


def _ok_response(content: str = "hi") -> FakeResponse:
    return FakeResponse(200, {"choices": [{"message": {"content": content}}]})


class FakeHTTPClient:
    """Serves responses in order (or raises an error) and records every call."""

    def __init__(
        self,
        responses: list[FakeResponse] | None = None,
        error: Exception | None = None,
    ) -> None:
        self.responses = responses or [_ok_response()]
        self.error = error
        self.posted_payloads: list[dict] = []

    async def post(self, url: str, headers: dict, json: dict) -> FakeResponse:
        self.posted_payloads.append(json)
        if self.error is not None:
            raise self.error
        return self.responses.pop(0)

    async def aclose(self) -> None: ...


def _client(monkeypatch: pytest.MonkeyPatch, http: FakeHTTPClient) -> LLMClient:
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: http)
    return LLMClient()


async def _no_sleep(_seconds: float) -> None:
    return None


async def test_generate_completion_returns_content(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client(monkeypatch, FakeHTTPClient())

    assert await client.generate_completion("system", "user") == "hi"


async def test_generate_completion_sends_chat_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_http = FakeHTTPClient()
    client = _client(monkeypatch, fake_http)

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
    client = _client(monkeypatch, fake_http)

    with pytest.raises(LLMError):
        await client.generate_completion("sys", "usr")

    assert len(fake_http.posted_payloads) == 1


async def test_retries_transient_failures_then_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
    fake_http = FakeHTTPClient(
        responses=[FakeResponse(500, {}), FakeResponse(500, {}), _ok_response()]
    )
    client = _client(monkeypatch, fake_http)

    assert await client.generate_completion("sys", "usr") == "hi"
    assert len(fake_http.posted_payloads) == 3


async def test_gives_up_after_max_attempts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
    fake_http = FakeHTTPClient(
        responses=[FakeResponse(500, {}), FakeResponse(500, {}), FakeResponse(500, {})]
    )
    client = _client(monkeypatch, fake_http)

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
            _ok_response(),
        ]
    )
    client = _client(monkeypatch, fake_http)

    assert await client.generate_completion("sys", "usr") == "hi"
    assert slept == [5.0]
    assert len(fake_http.posted_payloads) == 2


async def test_client_errors_not_retried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_http = FakeHTTPClient(responses=[FakeResponse(400, {})])
    client = _client(monkeypatch, fake_http)

    with pytest.raises(LLMError):
        await client.generate_completion("sys", "usr")

    assert len(fake_http.posted_payloads) == 1


async def test_cancellation_not_retried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_http = FakeHTTPClient(error=asyncio.CancelledError())
    client = _client(monkeypatch, fake_http)

    with pytest.raises(asyncio.CancelledError):
        await client.generate_completion("sys", "usr")

    assert len(fake_http.posted_payloads) == 1
