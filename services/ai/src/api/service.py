import asyncio
import functools
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import grpc

from src.config import settings
from src.domain.models import GeneratedPost
from src.domain.prompts import (
    POST_PROMPT,
    SUMMARY_PROMPT,
    TAGS_PROMPT,
    post_user_prompt,
)
from src.domain.reasons import build_reasons
from src.domain.sanitize import sanitize_post_html
from src.domain.text import clean_html, extract_json
from src.embeddings import EmbeddingError, EmbeddingProvider
from src.generated import ai_service_pb2, ai_service_pb2_grpc
from src.graphs.chat_graph import ChatGraphs, graphs_for_request
from src.graphs.feed_graph import EXPLORER, FRESH, FeedAgent, execute_blend
from src.graphs.post_graph import (
    STATUS_APPROVED,
    STATUS_PENDING,
    STATUS_REJECTED,
    draft_edits_patch,
    post_graph_config_for,
    resume_with_decision,
)
from src.graphs.state import ChatMessage
from src.llm import LLMError, LLMProvider, estimate_tokens
from src.observability import metrics
from src.observability.tracing import get_span_ids
from src.vector import SearchStore

logger = logging.getLogger(__name__)
access_logger = logging.getLogger("access")

Handler = Callable[..., Awaitable[Any]]
StreamHandler = Callable[..., AsyncIterator[Any]]
AccessFields = Callable[[Any, Any], dict[str, Any]]


class TooLargeError(Exception):
    """Raised when a request exceeds its configured size limit."""

    def __init__(self, limit: int) -> None:
        self.limit = limit


class ValidationError(Exception):
    """Raised when a request is malformed."""

    def __init__(self, message: str) -> None:
        self.message = message


class NotFoundError(Exception):
    """Raised when a referenced workflow or resource does not exist."""

    def __init__(self, message: str) -> None:
        self.message = message


_STATUS_TO_PROTO = {
    STATUS_PENDING: ai_service_pb2.WORKFLOW_STATUS_PENDING,
    STATUS_APPROVED: ai_service_pb2.WORKFLOW_STATUS_APPROVED,
    STATUS_REJECTED: ai_service_pb2.WORKFLOW_STATUS_REJECTED,
}


def _interaction_weight(kind: int) -> float | None:
    """Map an InteractionKind enum value to its profile fold weight.

    Unspecified or unknown kinds yield None so handlers can reject them.
    The weights mirror the content service's fixed view/like/save values
    and stay configurable via settings.
    """
    return {
        ai_service_pb2.INTERACTION_KIND_VIEW: settings.PROFILE_VIEW_WEIGHT,
        ai_service_pb2.INTERACTION_KIND_LIKE: settings.PROFILE_LIKE_WEIGHT,
        ai_service_pb2.INTERACTION_KIND_SAVE: settings.PROFILE_SAVE_WEIGHT,
    }.get(kind)


def _mode_name(mode: int) -> str:
    """Map a RecommendMode enum value to its metric and log label.

    UNSPECIFIED requests are served as default-mode feeds, so they share
    the default label.
    """
    return {
        ai_service_pb2.RECOMMEND_MODE_UNSPECIFIED: "default",
        ai_service_pb2.RECOMMEND_MODE_DEFAULT: "default",
        ai_service_pb2.RECOMMEND_MODE_SURPRISE: "surprise",
        ai_service_pb2.RECOMMEND_MODE_FRESH: "fresh",
        ai_service_pb2.RECOMMEND_MODE_EXPLORER: "explorer",
    }[mode]


def _preset_for_mode(mode: int) -> str | None:
    """The blend preset a mode maps to, when it names one explicitly.

    FRESH and EXPLORER are first-class modes served by the deterministic
    engine with preset knobs; DEFAULT/UNSPECIFIED/SURPRISE return None
    so they keep their dedicated paths (or the agent's pick).
    """
    if mode == ai_service_pb2.RECOMMEND_MODE_FRESH:
        return FRESH
    if mode == ai_service_pb2.RECOMMEND_MODE_EXPLORER:
        return EXPLORER
    return None


def _kind_name(kind: int) -> str:
    """Map an InteractionKind enum value to its metric and log label."""
    return {
        ai_service_pb2.INTERACTION_KIND_VIEW: "view",
        ai_service_pb2.INTERACTION_KIND_LIKE: "like",
        ai_service_pb2.INTERACTION_KIND_SAVE: "save",
    }[kind]


def _recommend_access_fields(
    request: ai_service_pb2.RecommendRequest,
    response: ai_service_pb2.RecommendResponse,
) -> dict[str, Any]:
    """Extra access-log fields describing a completed RecommendFeed call."""
    return {
        "mode": _mode_name(request.mode),
        "result_count": len(response.post_ids),
        "total": response.total,
    }


def _profile_access_fields(
    request: ai_service_pb2.UserProfileUpdateRequest,
    response: ai_service_pb2.UserProfileUpdateResponse,
) -> dict[str, Any]:
    """Extra access-log fields describing a completed UpdateUserProfile call."""
    return {"kind": _kind_name(request.kind)}


_recommend_calls = 0
_cold_start_calls = 0


def _record_recommend(mode: str, duration: float, cold_start: bool) -> None:
    """Record recommendation metrics for a successful RecommendFeed call.

    cold_start marks an empty feed, i.e. a user with no profile yet; the
    ratio gauge is the cumulative cold-start share since process start.
    """
    global _recommend_calls, _cold_start_calls
    metrics.RECOMMEND_REQUESTS.labels(method=mode, status="OK").inc()
    metrics.RECOMMEND_REQUEST_DURATION.labels(method=mode, status="OK").observe(
        duration
    )
    _recommend_calls += 1
    if cold_start:
        _cold_start_calls += 1
        metrics.RECOMMEND_COLD_START.inc()
    metrics.RECOMMEND_COLD_START_RATIO.set(_cold_start_calls / _recommend_calls)


def _record_rpc(
    method: str,
    status: str,
    start: float,
    extra: dict[str, Any] | None = None,
) -> None:
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
            **(extra or {}),
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


def rpc_metrics(
    method: str, extra_fields: AccessFields | None = None
) -> Callable[[Handler], Handler]:
    """Track metrics and access logs around a gRPC method handler.

    extra_fields maps a completed (request, response) pair to extra
    fields merged into the access log entry; it runs only on success.
    """

    def decorator(fn: Handler) -> Handler:
        @functools.wraps(fn)
        async def wrapper(
            self: Any, request: Any, context: grpc.aio.ServicerContext
        ) -> Any:
            start = time.perf_counter()
            status = "OK"
            metrics.GRPC_ACTIVE_REQUESTS.inc()
            fields: dict[str, Any] | None = None
            try:
                response = await fn(self, request, context)
                if extra_fields is not None:
                    fields = extra_fields(request, response)
                return response
            except TooLargeError as exc:
                status = "INVALID_ARGUMENT"
                await context.abort(
                    grpc.StatusCode.INVALID_ARGUMENT,
                    f"Input exceeds the maximum length of {exc.limit} characters",
                )
            except ValidationError as exc:
                status = "INVALID_ARGUMENT"
                await context.abort(grpc.StatusCode.INVALID_ARGUMENT, exc.message)
            except NotFoundError as exc:
                status = "NOT_FOUND"
                await context.abort(grpc.StatusCode.NOT_FOUND, exc.message)
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
                _record_rpc(method, status, start, extra=fields)

        return wrapper

    return decorator


class AIService(ai_service_pb2_grpc.AIServiceServicer):
    def __init__(
        self,
        llm: LLMProvider,
        search: SearchStore,
        embeddings: EmbeddingProvider,
        chat_graphs: ChatGraphs | None = None,
        post_generation_graph=None,
        feed_agent: FeedAgent | None = None,
    ) -> None:
        self._llm = llm
        self._search = search
        self._embeddings = embeddings
        self._chat_graphs = chat_graphs
        self._post_generation_graph = post_generation_graph
        self._feed_agent = feed_agent

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
        parsed = json.loads(extract_json(raw))
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
        post = GeneratedPost.model_validate_json(extract_json(raw))
        post.body = sanitize_post_html(post.body)
        return ai_service_pb2.PostGenerationResponse(
            title=post.title,
            body=post.body,
            summary=post.summary,
            tags=post.tags,
        )

    def _workflow_state_pb(
        self, values: dict[str, Any], approval_id: str
    ) -> ai_service_pb2.PostWorkflowState:
        status = _STATUS_TO_PROTO.get(values.get("status", ""), 0)
        return ai_service_pb2.PostWorkflowState(
            title=values.get("title", ""),
            body=values.get("body", ""),
            summary=values.get("summary", ""),
            tags=list(values.get("tags", [])),
            approval_id=approval_id,
            status=status,
        )

    async def _draft_state(self, approval_id: str) -> dict[str, Any]:
        """Checkpointed values of one draft workflow; empty when unknown."""
        config = post_graph_config_for(approval_id)
        snapshot = await self._post_generation_graph.aget_state(config)
        return dict(snapshot.values or {})

    @rpc_metrics("/ai.AIService/GeneratePostDraft")
    async def GeneratePostDraft(
        self,
        request: ai_service_pb2.PostGenerationRequest,
        context: grpc.aio.ServicerContext,
    ) -> ai_service_pb2.PostWorkflowState:
        """Generate a draft and pause the workflow at the review gate.

        The returned approval_id names the checkpointed thread; nothing
        is published until ApprovePost resumes it.
        """
        if self._post_generation_graph is None:
            raise RuntimeError("post generation graph is not configured")

        prompt = request.prompt.strip()
        if not prompt:
            raise ValidationError("prompt must be a non-empty string")
        if len(prompt) > settings.MAX_POST_CHARS:
            raise TooLargeError(settings.MAX_POST_CHARS)

        approval_id = uuid.uuid4().hex
        result = await self._post_generation_graph.ainvoke(
            {"prompt": prompt}, config=post_graph_config_for(approval_id)
        )
        return self._workflow_state_pb(result, approval_id)

    @rpc_metrics("/ai.AIService/ApprovePost")
    async def ApprovePost(
        self,
        request: ai_service_pb2.ApprovePostRequest,
        context: grpc.aio.ServicerContext,
    ) -> ai_service_pb2.PostWorkflowState:
        """Resume an approved draft; optional edits land before the resume.

        Idempotent: approving an already-approved workflow returns its
        stored payload without re-running anything.
        """
        if self._post_generation_graph is None:
            raise RuntimeError("post generation graph is not configured")

        if not request.approval_id:
            raise ValidationError("approval_id must be a non-empty string")

        values = await self._draft_state(request.approval_id)
        if not values.get("title"):
            raise NotFoundError(f"unknown approval_id: {request.approval_id}")
        if values.get("status") == STATUS_APPROVED:
            return self._workflow_state_pb(values, request.approval_id)

        edits = draft_edits_patch(
            title=request.title if request.HasField("title") else None,
            body=request.body if request.HasField("body") else None,
            summary=request.summary if request.HasField("summary") else None,
            tags=list(request.tags) or None,
        )
        result = await resume_with_decision(
            self._post_generation_graph,
            post_graph_config_for(request.approval_id),
            "approved",
            edits=edits,
        )
        return self._workflow_state_pb(result, request.approval_id)

    @rpc_metrics("/ai.AIService/RejectPost")
    async def RejectPost(
        self,
        request: ai_service_pb2.RejectPostRequest,
        context: grpc.aio.ServicerContext,
    ) -> ai_service_pb2.PostWorkflowState:
        """Record a rejection while keeping the workflow resumable.

        The state update leaves the thread paused at the review gate, so
        a later ApprovePost can still publish it. Idempotent for repeats.
        """
        if self._post_generation_graph is None:
            raise RuntimeError("post generation graph is not configured")

        if not request.approval_id:
            raise ValidationError("approval_id must be a non-empty string")

        values = await self._draft_state(request.approval_id)
        if not values.get("title"):
            raise NotFoundError(f"unknown approval_id: {request.approval_id}")
        if values.get("status") == STATUS_REJECTED:
            return self._workflow_state_pb(values, request.approval_id)

        updates: dict[str, Any] = {"status": STATUS_REJECTED}
        if request.reason.strip():
            updates["reason"] = request.reason
        await self._post_generation_graph.aupdate_state(
            post_graph_config_for(request.approval_id), updates
        )
        values.update(updates)
        return self._workflow_state_pb(values, request.approval_id)

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

    @rpc_metrics("/ai.AIService/UpdateUserProfile", extra_fields=_profile_access_fields)
    async def UpdateUserProfile(
        self,
        request: ai_service_pb2.UserProfileUpdateRequest,
        context: grpc.aio.ServicerContext,
    ) -> ai_service_pb2.UserProfileUpdateResponse:
        user_id = request.user_id.strip()
        if not user_id:
            raise ValidationError("user_id must be a non-empty string")
        if len(user_id) > settings.PROFILE_MAX_ID_CHARS:
            raise ValidationError(
                f"user_id length must be <= {settings.PROFILE_MAX_ID_CHARS} characters"
            )
        post_id = request.post_id.strip()
        if not post_id:
            raise ValidationError("post_id must be a non-empty string")
        weight = _interaction_weight(request.kind)
        if weight is None:
            raise ValidationError(f"unsupported interaction kind: {request.kind}")

        await self._search.update_user_profile(user_id, post_id, weight)
        metrics.PROFILE_UPDATES.labels(kind=_kind_name(request.kind)).inc()
        return ai_service_pb2.UserProfileUpdateResponse()

    @rpc_metrics("/ai.AIService/RecommendFeed", extra_fields=_recommend_access_fields)
    async def RecommendFeed(
        self,
        request: ai_service_pb2.RecommendRequest,
        context: grpc.aio.ServicerContext,
    ) -> ai_service_pb2.RecommendResponse:
        user_id = request.user_id.strip()
        if not user_id:
            raise ValidationError("user_id must be a non-empty string")
        if len(user_id) > settings.PROFILE_MAX_ID_CHARS:
            raise ValidationError(
                f"user_id length must be <= {settings.PROFILE_MAX_ID_CHARS} characters"
            )
        if request.mode not in (
            ai_service_pb2.RECOMMEND_MODE_UNSPECIFIED,
            ai_service_pb2.RECOMMEND_MODE_DEFAULT,
            ai_service_pb2.RECOMMEND_MODE_SURPRISE,
            ai_service_pb2.RECOMMEND_MODE_FRESH,
            ai_service_pb2.RECOMMEND_MODE_EXPLORER,
        ):
            raise ValidationError(f"unsupported recommend mode: {request.mode}")
        limit = request.limit or 10
        if limit > settings.SEARCH_MAX_LIMIT:
            raise ValidationError(f"limit must be <= {settings.SEARCH_MAX_LIMIT}")
        if request.offset + limit > settings.SEARCH_MAX_RESULT_WINDOW:
            raise ValidationError(
                f"pagination window exceeds {settings.SEARCH_MAX_RESULT_WINDOW}"
            )

        mode = _mode_name(request.mode)
        start = time.perf_counter()
        preset = _preset_for_mode(request.mode)
        if preset is not None:
            result = await execute_blend(
                self._search, user_id, request.offset, limit, preset, request.seed
            )
        elif self._feed_agent is not None and request.mode != (
            ai_service_pb2.RECOMMEND_MODE_SURPRISE
        ):
            preset = await self._feed_agent.decide(user_id)
            result = await execute_blend(
                self._search, user_id, request.offset, limit, preset, request.seed
            )
        elif request.mode == ai_service_pb2.RECOMMEND_MODE_SURPRISE:
            result = await self._search.recommend_surprise(
                user_id, request.offset, limit, request.seed
            )
        else:
            result = await self._search.recommend(user_id, request.offset, limit)
        _record_recommend(
            mode, time.perf_counter() - start, cold_start=result.total == 0
        )
        return ai_service_pb2.RecommendResponse(
            post_ids=result.post_ids,
            total=result.total,
            reasons=await self._recommendation_reasons(
                user_id,
                result.post_ids,
                surprise=request.mode == ai_service_pb2.RECOMMEND_MODE_SURPRISE,
            ),
        )

    async def _recommendation_reasons(
        self, user_id: str, post_ids: list[str], surprise: bool
    ) -> dict[str, str]:
        """Evidence lines for a feed page; empty for surprise feeds.

        Surprise posts are deliberately off-taste, so taste-based
        evidence would be misleading there.
        """
        if surprise or not post_ids:
            return {}
        tag_weights = await self._search.user_tag_weights(user_id)
        if not tag_weights:
            return {}
        return build_reasons(tag_weights, await self._search.post_tags(post_ids))

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
        """Run the grounded chat graph and stream its answer deltas.

        The graph rewrites, retrieves with judging, optionally calls
        tools, and generates the answer; answer-node deltas stream out of
        langgraph's custom channel. A thread id resumes the checkpointed
        session; without one the stateless variant runs and the caller's
        history seeds the conversation. The final chunk carries the post
        ids the model actually cited.
        """
        if self._chat_graphs is None:
            raise RuntimeError("chat graphs are not configured")

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

        inputs: dict[str, Any] = {"query": query, "top_k": top_k}
        if request.thread_id:
            # The checkpoint holds this session's turns.
            graph, config = graphs_for_request(self._chat_graphs, request.thread_id)
        else:
            graph, config = (
                self._chat_graphs.stateless,
                None,
            )
            history: list[ChatMessage] = []
            for message in request.history:
                role = message.role.strip()
                if role not in ("user", "assistant"):
                    raise ValidationError(f"unsupported history role: {role!r}")
                if len(message.content) > settings.MAX_INPUT_CHARS:
                    raise TooLargeError(settings.MAX_INPUT_CHARS)
                if message.content.strip():
                    history.append(
                        ChatMessage(role=role, content=message.content.strip())
                    )
            inputs["messages"] = history[-settings.CHAT_MAX_HISTORY_TURNS :]

        cited: list[str] = []
        completion_chars = 0
        async for payload in graph.astream(inputs, config=config, stream_mode="custom"):
            if isinstance(payload, str):
                completion_chars += len(payload)
                yield ai_service_pb2.ChatChunk(delta=payload)
            elif isinstance(payload, dict):
                cited = payload.get("cited_post_ids", [])

        access_logger.info(
            "chat completed",
            extra={
                "completion_tokens_est": estimate_tokens("x" * completion_chars),
                "cited_posts": len(cited),
                "thread_id": request.thread_id,
            },
        )
        yield ai_service_pb2.ChatChunk(done=True, cited_post_ids=cited)

    async def _embed(self, text: str) -> list[float]:
        """Embed a single text through the provider backing the Embed RPC."""
        return (await self._embeddings.embed([text]))[0]
