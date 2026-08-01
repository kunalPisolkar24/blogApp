import httpx
import pytest

from src.llm import LLMClient, LLMError


class FakeResponse:
    def __init__(self, status_code: int, body: dict) -> None:
        self.status_code = status_code
        self._body = body

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("POST", "http://example.com")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("boom", request=request, response=response)

    def json(self) -> dict:
        return self._body


class FakeHTTPClient:
    def __init__(self, status_code: int = 200, body: dict | None = None) -> None:
        self.status_code = status_code
        self.body = body or {"choices": [{"message": {"content": "hi"}}]}
        self.posted_payload: dict | None = None

    async def post(self, url: str, headers: dict, json: dict) -> FakeResponse:
        self.posted_payload = json
        return FakeResponse(self.status_code, self.body)

    async def aclose(self) -> None: ...


def _client(monkeypatch: pytest.MonkeyPatch, http: FakeHTTPClient) -> LLMClient:
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: http)
    return LLMClient()


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

    assert fake_http.posted_payload == {
        "model": "lightning-ai/gpt-oss-20b",
        "messages": [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "usr"},
        ],
        "temperature": 0.7,
        "max_tokens": 2048,
    }


async def test_http_error_raises_llm_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client(monkeypatch, FakeHTTPClient(status_code=500))

    with pytest.raises(LLMError):
        await client.generate_completion("sys", "usr")


async def test_unexpected_response_shape_raises_llm_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client(monkeypatch, FakeHTTPClient(body={"unexpected": True}))

    with pytest.raises(LLMError):
        await client.generate_completion("sys", "usr")
