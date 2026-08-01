from typing import Protocol

import httpx

from src.config import settings


class LLMError(Exception):
    """Raised when the LLM provider fails or returns an unexpected shape."""


class LLMProvider(Protocol):
    """Anything that turns a system + user prompt into a completion string."""

    async def generate_completion(self, system: str, user: str) -> str: ...


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
            response = await self._client.post(
                settings.LLM_API_URL, headers=headers, json=payload
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]
        except (httpx.HTTPError, KeyError, IndexError, TypeError) as exc:
            raise LLMError(str(exc)) from exc

    async def close(self) -> None:
        await self._client.aclose()
