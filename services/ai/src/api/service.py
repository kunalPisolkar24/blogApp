import asyncio
import functools
import json
import logging
import re
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import grpc

from src.config import settings
from src.domain.models import GeneratedPost
from src.domain.prompts import (
    CHAT_SYSTEM_PROMPT,
    POST_PROMPT,
    SUMMARY_PROMPT,
    TAGS_PROMPT,
    chat_user_prompt,
    post_user_prompt,
)
from src.domain.sanitize import sanitize_post_html
from src.domain.text import clean_html
from src.embeddings import EmbeddingError, EmbeddingProvider
from src.generated import ai_service_pb2, ai_service_pb2_grpc
from src.llm import LLMError, LLMProvider, estimate_tokens
from src.observability import metrics
from src.observability.tracing import get_span_ids
from src.vector import RetrievedPost, SearchStore

logger = logging.getLogger(__name__)
access_logger = logging.getLogger("access")

Handler = Callable[..., Awaitable[Any]]
StreamHandler = Callable[..., AsyncIterator[Any]]


class TooLargeError(Exception):
    """Raised when a request exceeds its configured size limit."""

    def __init__(self, limit: int) -> None:
        self.limit = limit


class ValidationError(Exception):
    """Raised when a request is malformed."""

    def __init__(self, message: str) -> None:
        self.message = message


def _extract_json(raw: str) -> str:
    """Strip markdown code fences around a JSON response."""
    match = re.search(r"```(?:json)?\s*(.+?)\s*```", raw, re.DOTALL)
    return match.group(1).strip() if match else raw.strip()


CITATION_RE = re.compile(r"\[(\d+)\]")


def _cited_post_ids(answer: str, contexts: list[RetrievedPost]) -> list[str]:
    """Map the [n] markers in an answer back to the retrieved post ids.

    The model is instructed to cite excerpts by their bracketed number;
    markers outside the retrieved range are ignored. When the answer cites
    nothing, every retrieved post is cited so the client can still surface
    the sources it was grounded in.
    """
    cited: list[str] = []
    for match in CITATION_RE.finditer(answer):
        index = int(match.group(1)) - 1
        if 0 <= index < len(contexts):
            post_id = contexts[index].post_id
            if post_id not in cited:
                cited.append(post_id)
    if not cited:
        cited = [post.post_id for post in contexts]
    return cited


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


def rpc_stream_metrics(method: str) -> Callable[[StreamHandler], StreamHandler]:
    """Track metrics and access logs around a server-streaming gRPC method.

    Mirrors rpc_metrics for handlers that yield multiple responses: the
    RPC is recorded when the stream ends, whether it completes, fails, or
    is cancelled by the client.
    """

    def decorator(fn: StreamHandler) -> StreamHandler:
        @functools.wraps(fn)
        async def wrapper(
            self: Any, request: Any, context: grpc.aio.ServicerContext
        ) -> Any:
            start = time.perf_counter()
            status = "OK"
            metrics.GRPC_ACTIVE_REQUESTS.inc()
            try:
                async for item in fn(self, request, context):
                    yield item
            except TooLargeError as exc:
                status = "INVALID_ARGUMENT"
                await context.abort(
                    grpc.StatusCode.INVALID_ARGUMENT,
                    f"Input exceeds the maximum length of {exc.limit} characters",
                )
            except ValidationError as exc:
                status = "INVALID_ARGUMENT"
                await context.abort(grpc.StatusCode.INVALID_ARGUMENT, exc.message)
            except LLMError:
                status = "UNAVAILABLE"
                logger.exception("LLM provider failed")
                await context.abort(
                    grpc.StatusCode.UNAVAILABLE, "LLM provider unavailable"
                )
            except EmbeddingError:
                status = "UNAVAILABLE"
                logger.exception("embedding provider failed")
                await context.abort(
                    grpc.StatusCode.UNAVAILABLE, "Embedding provider unavailable"
                )
            except asyncio.CancelledError:
                status = "CANCELLED"
                raise
            except Exception:
                status = "INTERNAL"
                logger.exception("unexpected error in %s", fn.__name__)
                await context.abort(grpc.StatusCode.INTERNAL, "Internal service error")
            finally:
                metrics.GRPC_ACTIVE_REQUESTS.dec()
                _record_rpc(method, status, start)

        return wrapper

    return decorator


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
            except ValidationError as exc:
                status = "INVALID_ARGUMENT"
                await context.abort(grpc.StatusCode.INVALID_ARGUMENT, exc.message)
            except LLMError:
                status = "UNAVAILABLE"
                logger.exception("LLM provider failed")
                await context.abort(
                    grpc.StatusCode.UNAVAILABLE, "LLM provider unavailable"
                )
            except EmbeddingError:
                status = "UNAVAILABLE"
                logger.exception("embedding provider failed")
                await context.abort(
                    grpc.StatusCode.UNAVAILABLE, "Embedding provider unavailable"
                )
            except asyncio.CancelledError:
                status = "CANCELLED"
                raise
            except Exception:
                status = "INTERNAL"
                logger.exception("unexpected error in %s", fn.__name__)
                await context.abort(grpc.StatusCode.INTERNAL, "Internal service error")
            finally:
                metrics.GRPC_ACTIVE_REQUESTS.dec()
                _record_rpc(method, status, start)

        return wrapper

    return decorator


class AIService(ai_service_pb2_grpc.AIServiceServicer):
    def __init__(
        self, llm: LLMProvider, search: SearchStore, embeddings: EmbeddingProvider
    ) -> None:
        self._llm = llm
        self._search = search
        self._embeddings = embeddings

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
            f"Title: {request.title[: settings.MAX_TITLE_CHARS]}\nBody: "
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

    @rpc_metrics("/ai.AIService/IndexPost")
    async def IndexPost(
        self, request: ai_service_pb2.IndexRequest, context: grpc.aio.ServicerContext
    ) -> ai_service_pb2.IndexResponse:
        if not request.post_id:
            raise ValidationError("post_id must be a non-empty string")
        if len(request.body) > settings.MAX_INPUT_CHARS:
            raise TooLargeError(settings.MAX_INPUT_CHARS)

        created_at = ""
        if request.HasField("created_at"):
            created_at = request.created_at.ToDatetime().strftime("%Y-%m-%dT%H:%M:%SZ")

        await self._search.upsert(
            post_id=request.post_id,
            title=request.title,
            body=request.body,
            summary=request.summary,
            tags=list(request.tags),
            created_at=created_at,
        )
        return ai_service_pb2.IndexResponse()

    @rpc_metrics("/ai.AIService/DeletePost")
    async def DeletePost(
        self, request: ai_service_pb2.DeleteRequest, context: grpc.aio.ServicerContext
    ) -> ai_service_pb2.DeleteResponse:
        if not request.post_id:
            raise ValidationError("post_id must be a non-empty string")

        await self._search.delete(request.post_id)
        return ai_service_pb2.DeleteResponse()

    @rpc_metrics("/ai.AIService/SearchPosts")
    async def SearchPosts(
        self, request: ai_service_pb2.SearchRequest, context: grpc.aio.ServicerContext
    ) -> ai_service_pb2.SearchResponse:
        query = request.query.strip()
        if not query:
            raise ValidationError("query must be a non-empty string")
        if len(query) > settings.SEARCH_MAX_QUERY_CHARS:
            raise ValidationError(
                f"query length must be <= {settings.SEARCH_MAX_QUERY_CHARS} characters"
            )
        limit = request.limit or 10
        if limit > settings.SEARCH_MAX_LIMIT:
            raise ValidationError(f"limit must be <= {settings.SEARCH_MAX_LIMIT}")
        if request.offset + limit > settings.SEARCH_MAX_RESULT_WINDOW:
            raise ValidationError(
                f"pagination window exceeds {settings.SEARCH_MAX_RESULT_WINDOW}"
            )

        result = await self._search.search(query, request.offset, limit)
        return ai_service_pb2.SearchResponse(
            post_ids=result.post_ids, total=result.total
        )

    @rpc_metrics("/ai.AIService/RelatedPosts")
    async def RelatedPosts(
        self, request: ai_service_pb2.RelatedRequest, context: grpc.aio.ServicerContext
    ) -> ai_service_pb2.RelatedResponse:
        if not request.post_id:
            raise ValidationError("post_id must be a non-empty string")
        limit = request.limit or settings.RELATED_DEFAULT_LIMIT
        if limit > settings.SEARCH_MAX_LIMIT:
            raise ValidationError(f"limit must be <= {settings.SEARCH_MAX_LIMIT}")

        post_ids = await self._search.related(request.post_id, limit)
        total = await self._search.count()
        return ai_service_pb2.RelatedResponse(post_ids=post_ids, total=total)

    @rpc_metrics("/ai.AIService/RelatedPostsBatch")
    async def RelatedPostsBatch(
        self,
        request: ai_service_pb2.RelatedBatchRequest,
        context: grpc.aio.ServicerContext,
    ) -> ai_service_pb2.RelatedBatchResponse:
        if not request.post_ids:
            raise ValidationError("post_ids must not be empty")
        limit = request.limit or settings.RELATED_DEFAULT_LIMIT
        if limit > settings.SEARCH_MAX_LIMIT:
            raise ValidationError(f"limit must be <= {settings.SEARCH_MAX_LIMIT}")

        post_ids = [post_id for post_id in dict.fromkeys(request.post_ids)]
        if any(not post_id for post_id in post_ids):
            raise ValidationError("post_ids must not contain empty strings")

        results = await asyncio.gather(
            *(self._search.related(post_id, limit) for post_id in post_ids)
        )
        total = await self._search.count()
        return ai_service_pb2.RelatedBatchResponse(
            results=[
                ai_service_pb2.RelatedBatchItem(
                    post_id=post_id,
                    related_post_ids=post_ids_for,
                    total=total,
                )
                for post_id, post_ids_for in zip(post_ids, results)
            ]
        )

    @rpc_metrics("/ai.AIService/Embed")
    async def Embed(
        self, request: ai_service_pb2.EmbedRequest, context: grpc.aio.ServicerContext
    ) -> ai_service_pb2.EmbedResponse:
        text = request.text.strip()
        if not text:
            raise ValidationError("text must be a non-empty string")
        if len(text) > settings.SEARCH_MAX_QUERY_CHARS:
            raise ValidationError(
                f"text length must be <= {settings.SEARCH_MAX_QUERY_CHARS} characters"
            )

        vector = await self._embed(text)
        return ai_service_pb2.EmbedResponse(vector=vector)

    @rpc_stream_metrics("/ai.AIService/ChatAnswer")
    async def ChatAnswer(
        self,
        request: ai_service_pb2.ChatAnswerRequest,
        context: grpc.aio.ServicerContext,
    ) -> AsyncIterator[ai_service_pb2.ChatChunk]:
        """Ground a question in the indexed posts and stream the answer.

        The query is embedded through the same path exposed by the Embed
        RPC, then the top-k closest posts are retrieved and handed to the
        LLM as numbered excerpts. The final chunk carries the post ids the
        model actually cited.
        """
        query = request.query.strip()
        if not query:
            raise ValidationError("query must be a non-empty string")
        if len(query) > settings.SEARCH_MAX_QUERY_CHARS:
            raise ValidationError(
                f"query length must be <= {settings.SEARCH_MAX_QUERY_CHARS} characters"
            )
        top_k = request.top_k or settings.CHAT_TOP_K_DEFAULT
        if top_k > settings.CHAT_MAX_TOP_K:
            raise ValidationError(f"top_k must be <= {settings.CHAT_MAX_TOP_K}")

        history: list[tuple[str, str]] = []
        for message in request.history:
            role = message.role.strip()
            if role not in ("user", "assistant"):
                raise ValidationError(f"unsupported history role: {role!r}")
            if len(message.content) > settings.MAX_INPUT_CHARS:
                raise TooLargeError(settings.MAX_INPUT_CHARS)
            if message.content.strip():
                history.append((role, message.content.strip()))
        history = history[-settings.CHAT_MAX_HISTORY_TURNS :]

        contexts = await self._retrieve_context(query, top_k)
        system = CHAT_SYSTEM_PROMPT
        user = chat_user_prompt(
            query, history, [(post.title, post.body) for post in contexts]
        )

        answer_parts: list[str] = []
        async for delta in self._llm.generate_stream(system, user):
            answer_parts.append(delta)
            yield ai_service_pb2.ChatChunk(delta=delta)

        answer = "".join(answer_parts)
        cited = _cited_post_ids(answer, contexts)
        access_logger.info(
            "chat completed",
            extra={
                "prompt_tokens_est": estimate_tokens(system + user),
                "completion_tokens_est": estimate_tokens(answer),
                "contexts": len(contexts),
                "cited_posts": len(cited),
            },
        )
        yield ai_service_pb2.ChatChunk(done=True, cited_post_ids=cited)

    async def _embed(self, text: str) -> list[float]:
        """Embed a single text through the provider backing the Embed RPC."""
        return (await self._embeddings.embed([text]))[0]

    async def _retrieve_context(self, query: str, top_k: int) -> list[RetrievedPost]:
        """Embed the query and fetch its nearest posts as grounding context.

        Body lengths are capped by the shared context budget so the
        prompt stays well inside the LLM's window regardless of top_k.
        """
        vector = await self._embed(query)
        posts = await self._search.retrieve_by_vector(vector, top_k)
        budget = settings.CHAT_MAX_CONTEXT_CHARS
        per_post = budget // len(posts) if posts else budget
        return [
            RetrievedPost(
                post_id=post.post_id, title=post.title, body=post.body[:per_post]
            )
            for post in posts
        ]
