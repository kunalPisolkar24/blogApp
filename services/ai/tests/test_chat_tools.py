import json

from src.graphs.chat_graph import build_chat_graph
from src.graphs.nodes import make_tool_loop
from src.graphs.tools import make_tool_registry
from src.llm import CompletionReply, FakeLLMClient, ToolRequest
from src.vector import RetrievedPost, SearchResult


def _post(post_id: str) -> RetrievedPost:
    return RetrievedPost(post_id=post_id, title=f"t {post_id}", body=f"b {post_id}")


class StubStore:
    """Store stub recording handler calls; serves one fixed post set."""

    def __init__(self, posts: list[RetrievedPost]) -> None:
        self.posts = list(posts)
        self.searched: list[tuple[str, int]] = []
        self.related_ids: list[str] = []

    async def search(self, query: str, offset: int, limit: int) -> SearchResult:
        self.searched.append((query, limit))
        return SearchResult(
            post_ids=[post.post_id for post in self.posts], total=len(self.posts)
        )

    async def related(self, post_id: str, limit: int) -> list[str]:
        self.related_ids.append(post_id)
        return [post.post_id for post in self.posts[:limit]]

    async def get_posts(self, post_ids: list[str]) -> list[RetrievedPost]:
        by_id = {post.post_id: post for post in self.posts}
        return [by_id[post_id] for post_id in post_ids if post_id in by_id]


class RecordingFakeLLM(FakeLLMClient):
    """FakeLLMClient that records the transcripts it is asked to run."""

    def __init__(self, tool_replies) -> None:
        super().__init__(tool_replies)
        self.seen_transcripts: list[list[dict]] = []

    async def generate_tool_completion(
        self, messages: list[dict], tools: list[dict]
    ) -> CompletionReply:
        self.seen_transcripts.append([dict(message) for message in messages])
        return await super().generate_tool_completion(messages, tools)


def _tool_reply(requests: tuple[ToolRequest, ...] = (), content: str | None = None):
    return CompletionReply(content=content, tool_requests=requests)


async def test_search_posts_handler_returns_excerpts() -> None:
    store = StubStore([_post("a")])
    registry = make_tool_registry(store)

    result = await registry["search_posts"](query="langgraph", limit=3)

    assert "[1] a: t a" in result
    assert "b a" in result
    assert store.searched == [("langgraph", 3)]


async def test_related_posts_handler_hydrates_ids() -> None:
    store = StubStore([_post("r1")])
    registry = make_tool_registry(store)

    result = await registry["related_posts"](post_id="origin", limit=2)

    assert "[1] r1: t r1" in result
    assert store.related_ids == ["origin"]


async def test_get_post_body_is_placeholder_without_fetcher() -> None:
    registry = make_tool_registry(StubStore([]))

    result = await registry["get_post_body"](post_id="abc")

    assert "not available yet" in result


async def test_get_post_body_uses_fetcher_when_present() -> None:
    async def fetcher(post_id: str) -> str:
        return f"full body of {post_id}"

    registry = make_tool_registry(StubStore([]), body_fetcher=fetcher)

    result = await registry["get_post_body"](post_id="abc")

    assert result == "full body of abc"


async def test_loop_executes_tools_and_feeds_results_back() -> None:
    llm = RecordingFakeLLM(
        [
            _tool_reply(
                (
                    ToolRequest(
                        id="call_1", name="search_posts", arguments='{"query": "q"}'
                    ),
                )
            ),
            _tool_reply(content="final answer"),
        ]
    )
    node = make_tool_loop(llm, make_tool_registry(StubStore([_post("a")])))

    result = await node({"query": "question", "retrieved": [_post("z")]})

    assert len(result["tool_calls"]) == 1
    assert result["tool_calls"][0].name == "search_posts"
    assert "[1] a: t a" in result["tool_calls"][0].result

    follow_up = llm.seen_transcripts[1]
    roles = [message["role"] for message in follow_up]
    assert roles == ["system", "user", "assistant", "tool"]
    assert follow_up[-1]["tool_call_id"] == "call_1"
    assert "[1] a: t a" in follow_up[-1]["content"]
    assistant = follow_up[2]
    assert assistant["tool_calls"][0]["function"]["name"] == "search_posts"


async def test_loop_handles_multiple_requests_in_one_reply() -> None:
    llm = RecordingFakeLLM(
        [
            _tool_reply(
                (
                    ToolRequest(
                        id="c1", name="search_posts", arguments='{"query": "q"}'
                    ),
                    ToolRequest(
                        id="c2", name="related_posts", arguments='{"post_id": "p"}'
                    ),
                )
            ),
            _tool_reply(content="done"),
        ]
    )
    node = make_tool_loop(llm, make_tool_registry(StubStore([_post("a")])))

    result = await node({"query": "q", "retrieved": []})

    assert [call.name for call in result["tool_calls"]] == [
        "search_posts",
        "related_posts",
    ]
    final_transcript = llm.seen_transcripts[-1]
    tool_messages = [m for m in final_transcript if m["role"] == "tool"]
    assert [m["tool_call_id"] for m in tool_messages] == ["c1", "c2"]


async def test_loop_stops_at_the_tool_call_cap() -> None:
    replies = [
        _tool_reply(
            (ToolRequest(id=str(i), name="search_posts", arguments='{"query": "q"}'),)
        )
        for i in range(10)
    ]
    llm = FakeLLMClient(replies)
    node = make_tool_loop(llm, make_tool_registry(StubStore([_post("a")])))

    result = await node({"query": "q", "retrieved": []})

    assert len(result["tool_calls"]) == 6


async def test_loop_survives_bad_arguments_and_unknown_tools() -> None:
    llm = RecordingFakeLLM(
        [
            _tool_reply(
                (
                    ToolRequest(id="c1", name="search_posts", arguments="not json"),
                    ToolRequest(id="c2", name="does_not_exist", arguments="{}"),
                )
            ),
            _tool_reply(content="done"),
        ]
    )
    node = make_tool_loop(llm, make_tool_registry(StubStore([])))

    result = await node({"query": "q", "retrieved": []})

    assert len(result["tool_calls"]) == 2
    first_error = json.loads(result["tool_calls"][0].result)
    second_error = json.loads(result["tool_calls"][1].result)
    assert "bad arguments" in first_error["error"]
    assert "unknown tool" in second_error["error"]


class GraphStore:
    """Full store surface the compiled graph needs across its nodes."""

    def __init__(self) -> None:
        self.posts = [_post("a")]
        self.dense_rounds = [self.posts[:]]
        self.hybrid_rounds: list[list[str]] = []
        self.searched: list[tuple[str, int]] = []

    async def retrieve_by_vector(
        self, vector: list[float], top_k: int
    ) -> list[RetrievedPost]:
        return self.dense_rounds.pop(0) if self.dense_rounds else []

    async def search(self, query: str, offset: int, limit: int) -> SearchResult:
        self.searched.append((query, limit))
        post_ids = self.hybrid_rounds.pop(0) if self.hybrid_rounds else []
        return SearchResult(post_ids=post_ids, total=len(post_ids))

    async def related(self, post_id: str, limit: int) -> list[str]:
        return [post.post_id for post in self.posts[:limit]]

    async def get_posts(self, post_ids: list[str]) -> list[RetrievedPost]:
        by_id = {post.post_id: post for post in self.posts}
        return [by_id[post_id] for post_id in post_ids if post_id in by_id]


class StubEmbeddingsGraph:
    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [[0.1] * 4 for _ in texts]


async def test_graph_routes_through_tool_loop_to_end() -> None:
    llm = FakeLLMClient([CompletionReply(content=None, tool_requests=())])
    graph = build_chat_graph(llm, GraphStore(), StubEmbeddingsGraph())

    result = await graph.ainvoke(
        {"query": "clear question", "thread_id": "", "top_k": 1}
    )

    assert result["tool_calls"] == []
