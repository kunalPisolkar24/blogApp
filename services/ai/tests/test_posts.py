import httpx
import pytest

from src.posts import FakePostFetcher, PostFetcher, PostFetchError


def _fetcher(handler, token="secret") -> PostFetcher:
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://content-service:4002",
    )
    return PostFetcher(client=client, token=token)


async def test_fetch_body_returns_body_and_sends_token() -> None:
    seen_headers = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_headers.update(request.headers)
        return httpx.Response(200, json={"id": "abc", "title": "t", "body": "full"})

    body = await _fetcher(handler).fetch_body("abc")

    assert body == "full"
    assert seen_headers["x-internal-secret"] == "secret"


async def test_fetch_body_maps_404_to_not_found() -> None:
    fetcher = _fetcher(lambda request: httpx.Response(404))

    with pytest.raises(PostFetchError, match="not found"):
        await fetcher.fetch_body("missing")


async def test_fetch_body_maps_unauthorized() -> None:
    fetcher = _fetcher(lambda request: httpx.Response(401), token="wrong")

    with pytest.raises(PostFetchError, match="rejected the internal token"):
        await fetcher.fetch_body("abc")


async def test_fetch_body_maps_server_errors() -> None:
    fetcher = _fetcher(lambda request: httpx.Response(500))

    with pytest.raises(PostFetchError, match="unexpected status 500"):
        await fetcher.fetch_body("abc")


async def test_fetch_body_maps_network_errors() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    fetcher = _fetcher(handler)

    with pytest.raises(PostFetchError, match="unreachable"):
        await fetcher.fetch_body("abc")


async def test_fetch_body_maps_malformed_json() -> None:
    fetcher = _fetcher(lambda request: httpx.Response(200, content=b"not-json"))

    with pytest.raises(PostFetchError, match="malformed"):
        await fetcher.fetch_body("abc")


async def test_fake_post_fetcher_hits_and_misses() -> None:
    fake = FakePostFetcher({"a": "body a"})

    assert await fake.fetch_body("a") == "body a"
    with pytest.raises(PostFetchError, match="not found"):
        await fake.fetch_body("b")
    assert fake.fetched == ["a", "b"]
