import logging
from typing import Protocol

import httpx
from tenacity import (
    before_sleep_log,
    retry,
    retry_if_exception,
    stop_after_attempt,
)

from src.config import settings

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
RETRYABLE_STATUSES = {429, 500, 502, 503, 504}


class LLMError(Exception):
    """Raised when the LLM provider fails or returns an unexpected shape."""


class LLMProvider(Protocol):
    """Anything that turns a system + user prompt into a completion string."""

    async def generate_completion(self, system: str, user: str) -> str: ...


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.RequestError):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in RETRYABLE_STATUSES
    return False


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

    async def generate_completion(self, system: str, user: str) -> str:
        payload = {
            "model": settings.LLM_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.7,
            "max_tokens": 2048,
        }
        headers = {
            "Authorization": f"Bearer {settings.LLM_API_KEY}",
            "Content-Type": "application/json",
        }

        try:
            data = await self._post(payload, headers)
            return data["choices"][0]["message"]["content"]
        except (httpx.HTTPError, KeyError, IndexError, TypeError) as exc:
            raise LLMError(str(exc)) from exc

    @retry(
        stop=stop_after_attempt(MAX_ATTEMPTS),
        wait=_wait_for_retry,
        retry=retry_if_exception(_is_retryable),
        before_sleep=before_sleep_log(logger, logging.WARNING),
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
