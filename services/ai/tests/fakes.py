import json
from collections.abc import AsyncIterator

import httpx
import pytest

from src.llm import LLMClient


class FakeResponse:
    """Minimal stand-in for httpx.Response, plain and streaming."""

    def __init__(
        self,
        status_code: int,
        body: dict,
        headers: dict | None = None,
        json_error: bool = False,
        lines: list[str] | None = None,
    ) -> None:
        self.status_code = status_code
        self.headers = headers or {}
        self._body = body
        self._json_error = json_error
        self._lines = lines

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("POST", "http://example.com")
            response = httpx.Response(
                self.status_code, request=request, headers=self.headers
            )
            raise httpx.HTTPStatusError("boom", request=request, response=response)

    def json(self) -> dict:
        if self._json_error:
            raise json.JSONDecodeError("bad json", "", 0)
        return self._body

    async def aiter_lines(self) -> AsyncIterator[str]:
        for line in self._lines or []:
            yield line

    async def aclose(self) -> None:
        return None


def ok_response(content: str = "hi") -> FakeResponse:
    return FakeResponse(200, {"choices": [{"message": {"content": content}}]})


def stream_response(chunks: list[str], usage: dict | None = None) -> FakeResponse:
    """SSE stream of content deltas, optionally ending with a usage frame."""
    lines = [
        f"data: {json.dumps({'choices': [{'delta': {'content': chunk}}]})}"
        for chunk in chunks
    ]
    if usage is not None:
        lines.append(f"data: {json.dumps({'choices': [], 'usage': usage})}")
    lines.append("data: [DONE]")
    return FakeResponse(200, {}, lines=lines)


class FakeHTTPClient:
    """Serves responses in order (or raises an error) and records every call."""

    def __init__(
        self,
        responses: list[FakeResponse] | None = None,
        error: BaseException | None = None,
    ) -> None:
        self.responses = responses or [ok_response()]
        self.error = error
        self.posted_payloads: list[dict] = []
        self.sent_payloads: list[dict] = []

    async def post(self, url: str, headers: dict, json: dict) -> FakeResponse:
        self.posted_payloads.append(json)
        if self.error is not None:
            raise self.error
        return self.responses.pop(0)

    def build_request(
        self,
        method: str,
        url: str,
        headers: dict | None = None,
        json: dict | None = None,
    ) -> dict:
        return {"method": method, "url": url, "headers": headers, "json": json}

    async def send(self, request: dict, stream: bool = False) -> FakeResponse:
        self.sent_payloads.append(request.get("json") or {})
        if self.error is not None:
            raise self.error
        return self.responses.pop(0)

    async def aclose(self) -> None: ...


def make_client(monkeypatch: pytest.MonkeyPatch, http: FakeHTTPClient) -> LLMClient:
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: http)
    return LLMClient()


async def no_sleep(_seconds: float) -> None:
    return None
