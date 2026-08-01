import asyncio
import functools
import json
import logging
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any

import grpc

from src import metrics
from src.config import settings
from src.domain.models import GeneratedPost
from src.domain.prompts import (
    POST_PROMPT,
    SUMMARY_PROMPT,
    TAGS_PROMPT,
    post_user_prompt,
)
from src.domain.sanitize import sanitize_post_html
from src.domain.text import clean_html
from src.generated import ai_service_pb2, ai_service_pb2_grpc
from src.llm import LLMError, LLMProvider
from src.tracing import get_span_ids

access_logger = logging.getLogger("access")

Handler = Callable[..., Awaitable[Any]]


class TooLargeError(Exception):
    """Raised when a request exceeds its configured size limit."""

    def __init__(self, limit: int) -> None:
        self.limit = limit


def _extract_json(raw: str) -> str:
    """Strip markdown code fences around a JSON response."""
    match = re.search(r"```(?:json)?\s*(.+?)\s*```", raw, re.DOTALL)
    return match.group(1).strip() if match else raw.strip()


def _record_rpc(method: str, status: str, start: float) -> None:
    duration = time.perf_counter() - start
    metrics.GRPC_REQUESTS.labels(method=method, status=status).inc()
    metrics.GRPC_REQUEST_DURATION.labels(method=method, status=status).observe(duration)
    trace_id, span_id = get_span_ids() or ("-", "-")
    access_logger.info(
        "rpc completed",
        extra={
            "method": method,
            "status": status,
            "duration_ms": round(duration * 1000, 1),
            "trace_id": trace_id,
            "span_id": span_id,
        },
    )


def rpc_metrics(method: str) -> Callable[[Handler], Handler]:
    """Track metrics and access logs around a gRPC method handler."""

    def decorator(fn: Handler) -> Handler:
        @functools.wraps(fn)
        async def wrapper(
            self: Any, request: Any, context: grpc.aio.ServicerContext
        ) -> Any:
            start = time.perf_counter()
            status = "OK"
            metrics.GRPC_ACTIVE_REQUESTS.inc()
            try:
                return await fn(self, request, context)
            except TooLargeError as exc:
                status = "INVALID_ARGUMENT"
                await context.abort(
                    grpc.StatusCode.INVALID_ARGUMENT,
                    f"Input exceeds the maximum length of {exc.limit} characters",
                )
            except LLMError:
                status = "UNAVAILABLE"
                await context.abort(
                    grpc.StatusCode.UNAVAILABLE, "LLM provider unavailable"
                )
            except asyncio.CancelledError:
                status = "CANCELLED"
                raise
            except Exception:  # noqa: BLE001 - unexpected errors become INTERNAL
                status = "INTERNAL"
                await context.abort(grpc.StatusCode.INTERNAL, "Internal service error")
            finally:
                metrics.GRPC_ACTIVE_REQUESTS.dec()
                _record_rpc(method, status, start)

        return wrapper

    return decorator


class AIService(ai_service_pb2_grpc.AIServiceServicer):
    def __init__(self, llm: LLMProvider) -> None:
        self._llm = llm

    @rpc_metrics("/ai.AIService/GenerateSummary")
    async def GenerateSummary(
        self, request: ai_service_pb2.ContentRequest, context: grpc.aio.ServicerContext
    ) -> ai_service_pb2.ContentResponse:
        if len(request.text) > settings.MAX_INPUT_CHARS:
            raise TooLargeError(settings.MAX_INPUT_CHARS)

        text = clean_html(request.text).strip()
        if not text:
            return ai_service_pb2.ContentResponse(summary="")

        summary = await self._llm.generate_completion(SUMMARY_PROMPT, text)
        return ai_service_pb2.ContentResponse(summary=summary)

    @rpc_metrics("/ai.AIService/GenerateTags")
    async def GenerateTags(
        self, request: ai_service_pb2.ContextRequest, context: grpc.aio.ServicerContext
    ) -> ai_service_pb2.TagsResponse:
        if len(request.body) > settings.MAX_INPUT_CHARS:
            raise TooLargeError(settings.MAX_INPUT_CHARS)

        content = (
            f"Title: {request.title}\nBody: "
            f"{clean_html(request.body).strip()[: settings.MAX_BODY_CHARS]}"
        )

        raw = await self._llm.generate_completion(TAGS_PROMPT, content)
        parsed = json.loads(_extract_json(raw))
        tags = parsed.get("tags") if isinstance(parsed, dict) else parsed
        if not isinstance(tags, list):
            raise TypeError("LLM response tags are not a list")
        return ai_service_pb2.TagsResponse(tags=[t for t in tags if isinstance(t, str)])

    @rpc_metrics("/ai.AIService/GeneratePost")
    async def GeneratePost(
        self,
        request: ai_service_pb2.PostGenerationRequest,
        context: grpc.aio.ServicerContext,
    ) -> ai_service_pb2.PostGenerationResponse:
        if len(request.prompt) > settings.MAX_POST_CHARS:
            raise TooLargeError(settings.MAX_POST_CHARS)

        raw = await self._llm.generate_completion(
            POST_PROMPT, post_user_prompt(request.prompt)
        )
        post = GeneratedPost.model_validate_json(_extract_json(raw))
        post.body = sanitize_post_html(post.body)
        return ai_service_pb2.PostGenerationResponse(
            title=post.title,
            body=post.body,
            summary=post.summary,
            tags=post.tags,
        )
