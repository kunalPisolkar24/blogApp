import json
import logging
import re
import time
from typing import NoReturn

import grpc
from pydantic import ValidationError

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


def _extract_json(raw: str) -> str:
    """Strip markdown code fences around a JSON response."""
    match = re.search(r"```(?:json)?\s*(.+?)\s*```", raw, re.DOTALL)
    return match.group(1).strip() if match else raw.strip()


async def _abort_unavailable(context: grpc.aio.ServicerContext) -> NoReturn:
    await context.abort(grpc.StatusCode.UNAVAILABLE, "LLM provider unavailable")


async def _abort_too_large(context: grpc.aio.ServicerContext, limit: int) -> NoReturn:
    await context.abort(
        grpc.StatusCode.INVALID_ARGUMENT,
        f"Input exceeds the maximum length of {limit} characters",
    )


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


class AIService(ai_service_pb2_grpc.AIServiceServicer):
    def __init__(self, llm: LLMProvider) -> None:
        self._llm = llm

    async def GenerateSummary(
        self, request: ai_service_pb2.ContentRequest, context: grpc.aio.ServicerContext
    ) -> ai_service_pb2.ContentResponse:
        start = time.perf_counter()
        status = "OK"
        metrics.GRPC_ACTIVE_REQUESTS.inc()
        try:
            if len(request.text) > settings.MAX_INPUT_CHARS:
                status = "INVALID_ARGUMENT"
                await _abort_too_large(context, settings.MAX_INPUT_CHARS)

            text = clean_html(request.text).strip()
            if not text:
                return ai_service_pb2.ContentResponse(summary="")

            try:
                summary = await self._llm.generate_completion(SUMMARY_PROMPT, text)
            except LLMError:
                status = "UNAVAILABLE"
                await _abort_unavailable(context)
            return ai_service_pb2.ContentResponse(summary=summary)
        finally:
            metrics.GRPC_ACTIVE_REQUESTS.dec()
            _record_rpc("/ai.AIService/GenerateSummary", status, start)

    async def GenerateTags(
        self, request: ai_service_pb2.ContextRequest, context: grpc.aio.ServicerContext
    ) -> ai_service_pb2.TagsResponse:
        start = time.perf_counter()
        status = "OK"
        metrics.GRPC_ACTIVE_REQUESTS.inc()
        try:
            if len(request.body) > settings.MAX_INPUT_CHARS:
                status = "INVALID_ARGUMENT"
                await _abort_too_large(context, settings.MAX_INPUT_CHARS)

            content = (
                f"Title: {request.title}\nBody: "
                f"{clean_html(request.body).strip()[: settings.MAX_BODY_CHARS]}"
            )

            try:
                raw = await self._llm.generate_completion(TAGS_PROMPT, content)
                tags = json.loads(_extract_json(raw))
                if isinstance(tags, dict):
                    tags = tags.get("tags", [])
                if not isinstance(tags, list):
                    raise TypeError("expected a list of strings")
                tags = [t for t in tags if isinstance(t, str)]
            except LLMError:
                status = "UNAVAILABLE"
                await _abort_unavailable(context)
            except (json.JSONDecodeError, TypeError):
                status = "INTERNAL"
                await context.abort(grpc.StatusCode.INTERNAL, "Invalid tags response")
            return ai_service_pb2.TagsResponse(tags=tags)
        finally:
            metrics.GRPC_ACTIVE_REQUESTS.dec()
            _record_rpc("/ai.AIService/GenerateTags", status, start)

    async def GeneratePost(
        self,
        request: ai_service_pb2.PostGenerationRequest,
        context: grpc.aio.ServicerContext,
    ) -> ai_service_pb2.PostGenerationResponse:
        start = time.perf_counter()
        status = "OK"
        metrics.GRPC_ACTIVE_REQUESTS.inc()
        try:
            if len(request.prompt) > settings.MAX_POST_CHARS:
                status = "INVALID_ARGUMENT"
                await _abort_too_large(context, settings.MAX_POST_CHARS)

            user_prompt = post_user_prompt(request.prompt)

            try:
                raw = await self._llm.generate_completion(POST_PROMPT, user_prompt)
                post = GeneratedPost.model_validate_json(_extract_json(raw))
            except LLMError:
                status = "UNAVAILABLE"
                await _abort_unavailable(context)
            except ValidationError:
                status = "INTERNAL"
                await context.abort(grpc.StatusCode.INTERNAL, "Invalid post response")
            post.body = sanitize_post_html(post.body)
            return ai_service_pb2.PostGenerationResponse(
                title=post.title,
                body=post.body,
                summary=post.summary,
                tags=post.tags,
            )
        finally:
            metrics.GRPC_ACTIVE_REQUESTS.dec()
            _record_rpc("/ai.AIService/GeneratePost", status, start)
