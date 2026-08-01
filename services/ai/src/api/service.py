import json
import re
from typing import NoReturn

import grpc
from pydantic import ValidationError

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


class AIService(ai_service_pb2_grpc.AIServiceServicer):
    def __init__(self, llm: LLMProvider) -> None:
        self._llm = llm

    async def GenerateSummary(
        self, request: ai_service_pb2.ContentRequest, context: grpc.aio.ServicerContext
    ) -> ai_service_pb2.ContentResponse:
        if len(request.text) > settings.MAX_INPUT_CHARS:
            await _abort_too_large(context, settings.MAX_INPUT_CHARS)

        text = clean_html(request.text).strip()
        if not text:
            return ai_service_pb2.ContentResponse(summary="")

        try:
            summary = await self._llm.generate_completion(SUMMARY_PROMPT, text)
        except LLMError:
            await _abort_unavailable(context)
        return ai_service_pb2.ContentResponse(summary=summary)

    async def GenerateTags(
        self, request: ai_service_pb2.ContextRequest, context: grpc.aio.ServicerContext
    ) -> ai_service_pb2.TagsResponse:
        if len(request.body) > settings.MAX_INPUT_CHARS:
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
            await _abort_unavailable(context)
        except (json.JSONDecodeError, TypeError):
            await context.abort(grpc.StatusCode.INTERNAL, "Invalid tags response")
        return ai_service_pb2.TagsResponse(tags=tags)

    async def GeneratePost(
        self,
        request: ai_service_pb2.PostGenerationRequest,
        context: grpc.aio.ServicerContext,
    ) -> ai_service_pb2.PostGenerationResponse:
        if len(request.prompt) > settings.MAX_POST_CHARS:
            await _abort_too_large(context, settings.MAX_POST_CHARS)

        user_prompt = post_user_prompt(request.prompt)

        try:
            raw = await self._llm.generate_completion(POST_PROMPT, user_prompt)
            post = GeneratedPost.model_validate_json(_extract_json(raw))
        except LLMError:
            await _abort_unavailable(context)
        except ValidationError:
            await context.abort(grpc.StatusCode.INTERNAL, "Invalid post response")
        post.body = sanitize_post_html(post.body)
        return ai_service_pb2.PostGenerationResponse(
            title=post.title,
            body=post.body,
            summary=post.summary,
            tags=post.tags,
        )
