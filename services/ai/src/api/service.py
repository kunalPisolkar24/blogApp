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
from src.generated import ai_service_pb2, ai_service_pb2_grpc
from src.llm import LLMError, LLMProvider

MAX_BODY_CHARS = 3000


def _extract_json(raw: str) -> str:
    """Strip markdown code fences around a JSON response."""
    match = re.search(r"```(?:json)?\s*(.+?)\s*```", raw, re.DOTALL)
    return match.group(1).strip() if match else raw.strip()


async def _abort_unavailable(context: grpc.aio.ServicerContext) -> NoReturn:
    await context.abort(grpc.StatusCode.UNAVAILABLE, "LLM provider unavailable")


class AIService(ai_service_pb2_grpc.AIServiceServicer):
    def __init__(self, llm: LLMProvider) -> None:
        self._llm = llm

    async def GenerateSummary(
        self, request: ai_service_pb2.ContentRequest, context: grpc.aio.ServicerContext
    ) -> ai_service_pb2.ContentResponse:
        text = request.text.strip()
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
        content = (
            f"Title: {request.title}\nBody: {request.body.strip()[:MAX_BODY_CHARS]}"
        )

        try:
            raw = await self._llm.generate_completion(TAGS_PROMPT, content)
            tags = json.loads(_extract_json(raw))
            if not isinstance(tags, list) or not all(
                isinstance(tag, str) for tag in tags
            ):
                raise ValueError("expected a list of strings")
        except LLMError:
            await _abort_unavailable(context)
        except (json.JSONDecodeError, ValueError):
            await context.abort(grpc.StatusCode.INTERNAL, "Invalid tags response")
        return ai_service_pb2.TagsResponse(tags=tags)

    async def GeneratePost(
        self,
        request: ai_service_pb2.PostGenerationRequest,
        context: grpc.aio.ServicerContext,
    ) -> ai_service_pb2.PostGenerationResponse:
        if len(request.prompt) > settings.MAX_POST_CHARS:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                f"Prompt exceeds the maximum length of {settings.MAX_POST_CHARS} characters",
            )

        user_prompt = post_user_prompt(request.prompt)

        try:
            raw = await self._llm.generate_completion(POST_PROMPT, user_prompt)
            post = GeneratedPost.model_validate_json(_extract_json(raw))
        except LLMError:
            await _abort_unavailable(context)
        except ValidationError:
            await context.abort(grpc.StatusCode.INTERNAL, "Invalid post response")
        return ai_service_pb2.PostGenerationResponse(
            title=post.title,
            body=post.body,
            summary=post.summary,
            tags=post.tags,
        )
