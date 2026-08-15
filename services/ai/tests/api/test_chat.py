from datetime import UTC, datetime
from uuid import uuid4

import grpc
import pytest

from src.config import settings
from src.generated import ai_service_pb2
from src.generated import ai_service_pb2_grpc as ai_stubs
from src.llm import LLMError
from tests.fake_llm import FakeLLM
from tests.scripted_embedding import ScriptedEmbedding


def _index_request(post_id: str, text: str) -> ai_service_pb2.IndexRequest:
    return ai_service_pb2.IndexRequest(
        post_id=post_id,
        title=text,
        body=f"<p>{text}</p>",
        summary=f"summary {text}",
        tags=["tutorial"],
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def _chat_request(
    query: str,
    top_k: int | None = None,
    history: list[ai_service_pb2.ChatMessage] | None = None,
) -> ai_service_pb2.ChatAnswerRequest:
    return ai_service_pb2.ChatAnswerRequest(
        query=query,
        top_k=top_k if top_k is not None else settings.CHAT_TOP_K_DEFAULT,
        history=list(history or []),
    )


async def _answer_chunks(stub, request) -> list[ai_service_pb2.ChatChunk]:
    chunks: list[ai_service_pb2.ChatChunk] = []
    async for chunk in stub.ChatAnswer(request):
        chunks.append(chunk)
    return chunks


@pytest.fixture
async def chat_stub(running_server_factory, fake_llm: FakeLLM):
    """Stub backed by ScriptedEmbedding so queries match indexed posts."""
    channel, _, _ = await running_server_factory(ScriptedEmbedding())
    return ai_stubs.AIServiceStub(channel)


async def test_chat_streams_answer_and_cites_retrieved_post(
    chat_stub, fake_llm: FakeLLM
) -> None:
    post_id = str(uuid4())
    await chat_stub.IndexPost(_index_request(post_id, "beta deployment guide"))
    fake_llm.chunks = ["Deploy with [1] for zero downtime. ", "See also [2]."]

    chunks = await _answer_chunks(chat_stub, _chat_request("beta deployment guide"))

    deltas = [chunk.delta for chunk in chunks if chunk.delta]
    assert "".join(deltas) == "Deploy with [1] for zero downtime. See also [2]."

    final = chunks[-1]
    assert final.done
    assert final.cited_post_ids == [post_id]


async def test_chat_cites_only_retrieved_posts(chat_stub, fake_llm: FakeLLM) -> None:
    first = str(uuid4())
    second = str(uuid4())
    await chat_stub.IndexPost(_index_request(first, "beta deployment guide"))
    await chat_stub.IndexPost(_index_request(second, "beta deployment guide"))
    fake_llm.chunks = ["Out of range citation [5] and [1]."]

    chunks = await _answer_chunks(chat_stub, _chat_request("beta deployment guide"))

    cited = chunks[-1].cited_post_ids
    assert len(cited) == 1
    assert cited[0] in {first, second}


async def test_chat_skips_unrelated_posts(chat_stub, fake_llm: FakeLLM) -> None:
    await chat_stub.IndexPost(_index_request(str(uuid4()), "alpha unrelated doc"))
    fake_llm.chunks = ["Nothing relevant found."]

    chunks = await _answer_chunks(chat_stub, _chat_request("beta deployment guide"))

    assert chunks[-1].cited_post_ids == []


async def test_chat_cites_all_context_when_answer_has_no_markers(
    chat_stub, fake_llm: FakeLLM
) -> None:
    post_id = str(uuid4())
    await chat_stub.IndexPost(_index_request(post_id, "beta deployment guide"))
    fake_llm.chunks = ["The guide covers rolling updates."]

    chunks = await _answer_chunks(chat_stub, _chat_request("beta deployment guide"))

    assert chunks[-1].cited_post_ids == [post_id]


async def test_chat_grounds_in_history_and_trims_long_history(
    chat_stub, fake_llm: FakeLLM
) -> None:
    await chat_stub.IndexPost(_index_request(str(uuid4()), "beta deployment guide"))
    history = [
        ai_service_pb2.ChatMessage(role=role, content="old turn")
        for role in ("user", "assistant") * settings.CHAT_MAX_HISTORY_TURNS
    ] + [ai_service_pb2.ChatMessage(role="user", content="newest turn")]
    fake_llm.chunks = ["Answer."]

    await _answer_chunks(
        chat_stub, _chat_request("beta deployment guide", history=history)
    )

    user_prompt = fake_llm.stream_calls[-1][1]
    assert "newest turn" in user_prompt
    assert user_prompt.count("old turn") == settings.CHAT_MAX_HISTORY_TURNS - 1


async def test_chat_rejects_empty_query(chat_stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await _answer_chunks(chat_stub, _chat_request("   "))

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_chat_rejects_unsupported_history_role(chat_stub) -> None:
    history = [ai_service_pb2.ChatMessage(role="system", content="be nice")]
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await _answer_chunks(chat_stub, _chat_request("beta guide", history=history))

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_chat_rejects_excessive_top_k(chat_stub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await _answer_chunks(chat_stub, _chat_request("beta guide", top_k=11))

    assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_chat_aborts_when_llm_fails(chat_stub, fake_llm: FakeLLM) -> None:
    fake_llm.error = LLMError("provider down")

    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await _answer_chunks(chat_stub, _chat_request("beta guide"))

    assert exc_info.value.code() == grpc.StatusCode.UNAVAILABLE
