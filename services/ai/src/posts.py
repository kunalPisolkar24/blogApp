"""Fetch full post bodies from the content service."""

import httpx

from src.config import settings

# A stuck body fetch must not stall the whole chat turn.
_TIMEOUT_SECONDS = 10.0


class PostFetchError(Exception):
    """Raised when a post body cannot be fetched."""


class PostFetcher:
    """Authenticated client for the content service's internal posts API."""

    def __init__(
        self,
        base_url: str | None = None,
        token: str | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._token = token or settings.CONTENT_INTERNAL_TOKEN
        self._client = client or httpx.AsyncClient(
            base_url=base_url or settings.CONTENT_SERVICE_URL,
            timeout=_TIMEOUT_SECONDS,
        )

    async def fetch_body(self, post_id: str) -> str:
        try:
            response = await self._client.get(
                f"/internal/posts/{post_id}",
                headers={"X-Internal-Secret": self._token},
            )
        except httpx.HTTPError as exc:
            raise PostFetchError(f"content service unreachable: {exc}") from exc

        if response.status_code == 404:
            raise PostFetchError(f"post {post_id} not found")
        if response.status_code in (401, 403):
            raise PostFetchError("content service rejected the internal token")
        if response.status_code != 200:
            raise PostFetchError(
                f"unexpected status {response.status_code} from content service"
            )

        try:
            return response.json()["body"]
        except (ValueError, KeyError) as exc:
            raise PostFetchError(f"malformed response for post {post_id}") from exc

    async def close(self) -> None:
        await self._client.aclose()


class FakePostFetcher:
    """In-memory twin backed by a dict of post bodies."""

    def __init__(self, bodies: dict[str, str] | None = None) -> None:
        self.bodies = dict(bodies or {})
        self.fetched: list[str] = []

    async def fetch_body(self, post_id: str) -> str:
        self.fetched.append(post_id)
        if post_id not in self.bodies:
            raise PostFetchError(f"post {post_id} not found")
        return self.bodies[post_id]
