import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol

import httpx
from langsmith import traceable
from tenacity import retry, retry_if_exception, stop_after_attempt

from src.config import settings
from src.domain.prompts import (
    CHAT_SYSTEM_PROMPT,
    POST_PROMPT,
    SUMMARY_PROMPT,
    TAGS_PROMPT,
)
from src.observability import metrics

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
RETRYABLE_STATUSES = {429, 500, 502, 503, 504}


class LLMError(Exception):
    """Raised when the LLM provider fails or returns an unexpected shape."""


@dataclass(frozen=True)
class TokenUsage:
    """Token counts reported by the provider for one completion call."""

    prompt_tokens: int | None = None
    completion_tokens: int | None = None

    @property
    def total_tokens(self) -> int | None:
        if self.prompt_tokens is None and self.completion_tokens is None:
            return None
        return (self.prompt_tokens or 0) + (self.completion_tokens or 0)


def estimate_tokens(text: str) -> int:
    """Rough token count (chars / 4) used when the provider omits usage."""
    return len(text) // 4


def _parse_usage(usage: dict | None) -> TokenUsage | None:
    if not isinstance(usage, dict):
        return None
    return TokenUsage(
        prompt_tokens=usage.get("prompt_tokens"),
        completion_tokens=usage.get("completion_tokens"),
    )


def _record_tokens(
    usage: TokenUsage | None, method: str, prompt_chars: int, completion_chars: int
) -> None:
    """Record token usage, estimating each count the provider did not report.

    The estimate (chars / 4) matches estimate_tokens() for logging.
    """
    prompt = usage.prompt_tokens if usage is not None else None
    if prompt is None:
        prompt = prompt_chars // 4
    completion = usage.completion_tokens if usage is not None else None
    if completion is None:
        completion = completion_chars // 4
    metrics.LLM_TOKENS.labels(method=method, token_type="prompt").inc(prompt)
    metrics.LLM_TOKENS.labels(method=method, token_type="completion").inc(completion)
    metrics.LLM_TOKENS.labels(method=method, token_type="total").inc(
        prompt + completion
    )


class LLMProvider(Protocol):
    """Anything that turns a system + user prompt into completions.

    Implementations may be async generator functions (their call already
    returns an async iterator), so callers always use
    ``async for chunk in llm.generate_stream(...)``.
    """

    async def generate_completion(self, system: str, user: str) -> str: ...

    def generate_stream(self, system: str, user: str) -> AsyncIterator[str]: ...


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.RequestError):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in RETRYABLE_STATUSES
    return False


class _StreamUsage:
    """Captures the usage frame from a streaming response."""

    def __init__(self) -> None:
        self.usage: dict | None = None

    def record(self, usage: dict) -> None:
        self.usage = usage


async def _sse_deltas(
    response: httpx.Response, usage: _StreamUsage
) -> AsyncIterator[str]:
    """Yield ``content`` deltas from an OpenAI-style SSE stream.

    When the request sets ``stream_options.include_usage`` the provider
    emits a final usage frame after the last content delta; it is captured
    for token accounting. A malformed frame surfaces as LLMError in the
    caller.
    """
    async for line in response.aiter_lines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        payload = json.loads(data)
        usage_value = payload.get("usage")
        if isinstance(usage_value, dict):
            usage.record(usage_value)
        choices = payload.get("choices") or []
        if not choices:
            continue
        delta = choices[0].get("delta", {})
        content = delta.get("content")
        if content:
            yield content


def _before_retry(retry_state) -> None:
    logger.warning("retrying LLM call after attempt %s", retry_state.attempt_number)
    metrics.LLM_RETRIES.inc()


def _wait_for_retry(retry_state) -> float:
    exc = retry_state.outcome.exception()
    if isinstance(exc, httpx.HTTPStatusError):
        retry_after = exc.response.headers.get("Retry-After")
        if retry_after is not None:
            try:
                return min(float(retry_after), 30)
            except ValueError:
                pass  # HTTP-date form — fall back to backoff
    return min(2**retry_state.attempt_number, 10)


class LLMClient:
    """OpenAI-compatible chat completions client for the Lightning AI API."""

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=settings.LLM_TIMEOUT_SECONDS)

    def _payload(self, system: str, user: str, stream: bool) -> dict:
        payload = {
            "model": settings.LLM_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.7,
            "max_tokens": 2048,
            "stream": stream,
        }
        if stream:
            # Ask for a final usage frame so token accounting works for
            # streaming calls too; the frame carries no content delta.
            payload["stream_options"] = {"include_usage": True}
        return payload

    @traceable(run_type="llm")
    async def generate_completion(self, system: str, user: str) -> str:
        payload = self._payload(system, user, stream=False)
        headers = {
            "Authorization": f"Bearer {settings.LLM_API_KEY}",
            "Content-Type": "application/json",
        }

        start = time.perf_counter()
        status = "error"
        try:
            data = await self._post(payload, headers)
            result = data["choices"][0]["message"]["content"]
            status = "success"
            _record_tokens(
                _parse_usage(data.get("usage")),
                method="completion",
                prompt_chars=len(system) + len(user),
                completion_chars=len(result),
            )
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
            raise LLMError(str(exc)) from exc
        finally:
            metrics.LLM_REQUEST_DURATION.observe(time.perf_counter() - start)
            metrics.LLM_REQUESTS.labels(status=status).inc()
        return result

    @traceable(run_type="llm")
    async def generate_stream(self, system: str, user: str) -> AsyncIterator[str]:
        """Stream completion deltas from the provider.

        Connection-level failures are retried (no content has been sent
        yet); failures after the first delta are raised as LLMError and
        never retried, since a partial answer cannot be replayed safely.
        """
        payload = self._payload(system, user, stream=True)
        headers = {
            "Authorization": f"Bearer {settings.LLM_API_KEY}",
            "Content-Type": "application/json",
        }

        start = time.perf_counter()
        status = "error"
        stream_usage = _StreamUsage()
        completion_chars = 0
        try:
            response = await self._open_stream(payload, headers)
            try:
                async for delta in _sse_deltas(response, stream_usage):
                    completion_chars += len(delta)
                    yield delta
            finally:
                await response.aclose()
            status = "success"
            _record_tokens(
                _parse_usage(stream_usage.usage),
                method="stream",
                prompt_chars=len(system) + len(user),
                completion_chars=completion_chars,
            )
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
            raise LLMError(str(exc)) from exc
        finally:
            metrics.LLM_REQUEST_DURATION.observe(time.perf_counter() - start)
            metrics.LLM_REQUESTS.labels(status=status).inc()

    @retry(
        stop=stop_after_attempt(MAX_ATTEMPTS),
        wait=_wait_for_retry,
        retry=retry_if_exception(_is_retryable),
        before_sleep=_before_retry,
        reraise=True,
    )
    async def _open_stream(self, payload: dict, headers: dict) -> httpx.Response:
        """Open the streaming response, retrying transient failures."""
        request = self._client.build_request(
            "POST", settings.LLM_API_URL, headers=headers, json=payload
        )
        response = await self._client.send(request, stream=True)
        response.raise_for_status()
        return response

    @retry(
        stop=stop_after_attempt(MAX_ATTEMPTS),
        wait=_wait_for_retry,
        retry=retry_if_exception(_is_retryable),
        before_sleep=_before_retry,
        reraise=True,
    )
    async def _post(self, payload: dict, headers: dict) -> dict:
        response = await self._client.post(
            settings.LLM_API_URL, headers=headers, json=payload
        )
        response.raise_for_status()
        return response.json()

    async def close(self) -> None:
        await self._client.aclose()


class FakeLLMClient:
    """Returns canned responses without network calls, for local load testing."""

    _SUMMARY = "A concise three-sentence summary generated for load testing."
    _TAGS = '["loadtest", "capacity", "benchmark", "grpc", "performance"]'
    _POST = json.dumps(
        {
            "title": "Load Test Post",
            "body": (
                "<h2>Introduction</h2><p>Generated HTML content for load "
                "testing.</p><ul><li>Point one</li><li>Point two</li></ul>"
                "<h2>Conclusion</h2><p>Wrapping up the load test post.</p>"
            ),
            "summary": "A short summary of the load test post.",
            "tags": ["loadtest", "capacity"],
        }
    )

    _CHAT_ANSWER = (
        "The platform stores posts in Qdrant for semantic retrieval. [1] "
        "Embeddings are generated with Ollama before indexing. [1] "
        "Related posts reuse the stored vector at read time. [2]"
    )

    def __init__(self) -> None:
        self._responses = {
            SUMMARY_PROMPT: self._SUMMARY,
            TAGS_PROMPT: self._TAGS,
            POST_PROMPT: self._POST,
            CHAT_SYSTEM_PROMPT: self._CHAT_ANSWER,
        }

    @traceable(run_type="llm")
    async def generate_completion(self, system: str, user: str) -> str:
        return self._responses.get(system, self._SUMMARY)

    @traceable(run_type="llm")
    async def generate_stream(self, system: str, user: str) -> AsyncIterator[str]:
        """Emit the canned answer word by word so streaming is exercised."""
        answer = self._responses.get(system, self._SUMMARY)
        for word in answer.split():
            yield word + " "
            await asyncio.sleep(0.001)

    async def close(self) -> None:
        return None
