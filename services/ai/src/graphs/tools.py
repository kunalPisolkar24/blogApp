"""Agent tools for the chat graph's dispatch loop.

Schemas follow the OpenAI tool-calling format the provider accepts
(verified in the M0 spike); handlers wrap existing SearchStore methods
and return compact text excerpts the model can read.
"""

import json
from collections.abc import Awaitable, Callable

from src.vector import SearchStore

TOOL_AGENT_PROMPT = """
You are the Topos blog assistant. You are given retrieved blog post
excerpts and tools to search more posts. Call a tool only when the
excerpts do not already answer what you need: use search_posts for
other topics or wording, related_posts to expand on a known post, and
get_post_body when an excerpt is truncated and you need the rest.
Refer to posts by their post_id. When you have enough information,
answer directly without calling tools.
""".strip()

# Bodies fed back into tool results stay small; the model needs gist,
# not the full document (the full-body source arrives with #154).
_RESULT_BODY_CHARS = 400

ToolHandler = Callable[..., Awaitable[str]]

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "search_posts",
            "description": "Search indexed blog posts by a text query.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {
                        "type": "integer",
                        "description": "Maximum posts to return (default 3).",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "related_posts",
            "description": "Find posts related to a known post id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "post_id": {"type": "string"},
                    "limit": {
                        "type": "integer",
                        "description": "Maximum posts to return (default 3).",
                    },
                },
                "required": ["post_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_post_body",
            "description": "Fetch the full body of a post by its post_id.",
            "parameters": {
                "type": "object",
                "properties": {"post_id": {"type": "string"}},
                "required": ["post_id"],
            },
        },
    },
]


def _format_posts(posts) -> str:
    """Render hydrated posts as numbered title+body excerpts."""
    if not posts:
        return "(no matching posts)"
    blocks = [
        f"[{index}] {post.post_id}: {post.title}\n{post.body[:_RESULT_BODY_CHARS]}"
        for index, post in enumerate(posts, start=1)
    ]
    return "\n\n".join(blocks)


def make_tool_registry(
    search: SearchStore, body_fetcher: Callable[[str], Awaitable[str]] | None = None
) -> dict[str, ToolHandler]:
    """Build the name -> handler registry backing the tool schemas."""

    async def search_posts(query: str, limit: int = 3) -> str:
        result = await search.search(query, 0, limit)
        return _format_posts(await search.get_posts(result.post_ids))

    async def related_posts(post_id: str, limit: int = 3) -> str:
        related_ids = await search.related(post_id, limit)
        return _format_posts(await search.get_posts(related_ids))

    async def get_post_body(post_id: str) -> str:
        if body_fetcher is None:
            # Placeholder until the content-service bridge lands (#154).
            return f"(full body for {post_id} is not available yet)"
        return await body_fetcher(post_id)

    return {
        "search_posts": search_posts,
        "related_posts": related_posts,
        "get_post_body": get_post_body,
    }


def format_tool_error(name: str, detail: str) -> str:
    """Render a tool failure as a result the model can react to."""
    return json.dumps({"error": f"{name} failed: {detail}"})
