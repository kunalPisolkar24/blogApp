import type { FieldPolicy } from "@apollo/client";
import { InMemoryCache } from "@apollo/client";
import { beforeAll, describe, expect, it } from "vitest";
import {
  MyPostsDocument,
  PostDocument,
  PostsByTagDocument,
  PostsDocument,
  SearchPostsDocument,
  type ContentPostCard,
  type ContentPostDetail,
} from "@/shared/graphql/content-documents";

import { buildApolloCache } from "../index";
import { mergePaginatedPostLists, paginatedPostListKeyArgs } from "../policies/post";
import { invalidatePostListCaches } from "../../../refetchLists";

const buildList = (page: number, ids: Array<string | number>) => ({
  __typename: "PaginatedPosts",
  posts: ids.map((id) => ({ __ref: `Post:${id}`, id })),
  totalPages: 5,
  currentPage: page,
  totalPosts: 50,
});

const runMerge = (
  policy: FieldPolicy,
  existing: unknown,
  incoming: unknown,
  args: Record<string, unknown>,
) => {
  const mergeFn = policy.merge as (
    existing: unknown,
    incoming: unknown,
    ctx: { args: Record<string, unknown> | null },
  ) => unknown;
  return mergeFn(existing, incoming, { args });
};

const buildPostCard = (id: string): ContentPostCard => ({
  __typename: "Post",
  id,
  title: `Post ${id}`,
  body: "<p>body</p>",
  imageUrl: "https://x/y.png",
  createdAt: "2024-01-01T00:00:00Z",
  likedByMe: false,
  savedByMe: false,
  author: {
    __typename: "User",
    id: "author-1",
    username: "alice",
    name: "Alice",
    avatarUrl: null,
  },
  tags: [
    {
      __typename: "Tag",
      id: "tag-1",
      name: "alpha",
    },
  ],
});

const buildPostDetail = (id: string): ContentPostDetail => {
  const card = buildPostCard(id);

  return {
    ...card,
    slug: `post-${id}`,
    summary: null,
    summaryStatus: "COMPLETED",
    updatedAt: "2024-01-01T00:00:00Z",
    author: {
      ...card.author,
      email: "alice@example.com",
      bio: null,
    },
    related: [],
  };
};

const buildPaginatedPosts = (ids: string[]) => ({
  __typename: "PaginatedPosts" as const,
  posts: ids.map(buildPostCard),
  totalPages: 1,
  currentPage: 1,
  totalPosts: ids.length,
});

const hasCacheRecord = (cache: InMemoryCache, id: string) =>
  Object.prototype.hasOwnProperty.call(cache.extract(false), id);

describe("mergePaginatedPostLists", () => {
  it("replaces the list on page 1", () => {
    const merged = mergePaginatedPostLists(buildList(1, ["a", "b"]), buildList(1, ["c"]), {
      args: { page: 1, limit: 2 },
    });
    expect(merged).toEqual(buildList(1, ["c"]));
  });

  it("appends deduped items on subsequent pages", () => {
    const merged = mergePaginatedPostLists(buildList(1, ["a", "b"]), buildList(2, ["b", "c"]), {
      args: { page: 2, limit: 2 },
    });
    const list = (merged as { posts: Array<{ id: string }> }).posts;
    expect(list.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("preserves incoming when there is no existing data", () => {
    const merged = mergePaginatedPostLists(undefined, buildList(2, ["x"]), {
      args: { page: 2, limit: 2 },
    });
    expect(merged).toEqual(buildList(2, ["x"]));
  });

  it("preserves existing when there is no incoming data", () => {
    const merged = mergePaginatedPostLists(buildList(1, ["a"]), undefined, {
      args: { page: 1, limit: 2 },
    });
    expect(merged).toEqual(buildList(1, ["a"]));
  });

  it("returns incoming when posts is not an array", () => {
    const merged = mergePaginatedPostLists(
      { __typename: "PaginatedPosts", posts: "not-array", totalPages: 1, currentPage: 1, totalPosts: 0 },
      buildList(1, ["a"]),
      { args: { page: 1, limit: 2 } },
    );
    expect(merged).toEqual(buildList(1, ["a"]));
  });
});

describe("paginatedPostListKeyArgs", () => {
  it("returns empty string for null args", () => {
    expect(paginatedPostListKeyArgs(null)).toBe("");
  });

  it("uses default values when args are missing", () => {
    const result = paginatedPostListKeyArgs({});
    expect(result).toContain("tag:");
    expect(result).toContain("page:1");
    expect(result).toContain("limit:");
  });

  it("includes tag in key args", () => {
    const result = paginatedPostListKeyArgs({ tag: "alpha" });
    expect(result).toContain("tag:alpha");
  });

  it("includes mode and seed in key args", () => {
    const result = paginatedPostListKeyArgs({ mode: "SURPRISE", seed: 42 });
    expect(result).toContain("mode:SURPRISE");
    expect(result).toContain("seed:42");
  });
});

describe("mergePaginatedPostLists edge cases", () => {
  it("returns incoming for page 0", () => {
    const merged = mergePaginatedPostLists(buildList(1, ["a"]), buildList(0, ["b"]), {
      args: { page: 0, limit: 2 },
    });
    expect(merged).toEqual(buildList(0, ["b"]));
  });

  it("handles null incoming with existing", () => {
    const merged = mergePaginatedPostLists(buildList(1, ["a"]), null, {
      args: { page: 2, limit: 2 },
    });
    expect(merged).toEqual(buildList(1, ["a"]));
  });

  it("deduplicates items without id field", () => {
    const existing = {
      __typename: "PaginatedPosts",
      posts: [{ __ref: "Post:a", id: "a" }, { __ref: "Post:b" }],
      totalPages: 5,
      currentPage: 1,
      totalPosts: 50,
    };
    const incoming = {
      __typename: "PaginatedPosts",
      posts: [{ __ref: "Post:b" }, { __ref: "Post:c" }],
      totalPages: 5,
      currentPage: 2,
      totalPosts: 50,
    };
    const merged = mergePaginatedPostLists(existing, incoming, {
      args: { page: 2, limit: 2 },
    });
    const list = (merged as { posts: Array<{ __ref: string }> }).posts;
    expect(list.map((p) => p.__ref)).toEqual(["Post:a", "Post:b", "Post:c"]);
  });
});

describe("buildApolloCache", () => {
  let postsPolicy: FieldPolicy;

  beforeAll(() => {
    const cache = buildApolloCache();
    const policies = (
      cache as unknown as { config: { typePolicies: { Query?: { fields?: Record<string, FieldPolicy> } } } }
    ).config.typePolicies;
    const next = policies.Query?.fields?.posts;
    if (!next) throw new Error("posts policy missing");
    postsPolicy = next;
  });

  it("constructs an InMemoryCache", () => {
    expect(buildApolloCache()).toBeInstanceOf(InMemoryCache);
  });

  it("wires the paginated posts merge policy", () => {
    const merged = runMerge(
      postsPolicy,
      buildList(1, ["a", "b"]),
      buildList(2, ["b", "c"]),
      { page: 2, limit: 2 },
    );
    const list = (merged as { posts: Array<{ id: string }> }).posts;
    expect(list.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});

describe("invalidatePostListCaches", () => {
  it("removes stale home feed cache entries", () => {
    const cache = buildApolloCache();
    const variables = { page: 1, limit: 6 };

    cache.writeQuery({
      query: PostsDocument,
      variables,
      data: {
        posts: buildPaginatedPosts(["home-1"]),
      },
    });

    expect(cache.readQuery({ query: PostsDocument, variables })).not.toBeNull();

    invalidatePostListCaches(cache);

    expect(cache.readQuery({ query: PostsDocument, variables })).toBeNull();
  });

  it("removes stale tag feed cache entries", () => {
    const cache = buildApolloCache();
    const variables = { tag: "alpha", page: 1, limit: 6 };

    cache.writeQuery({
      query: PostsByTagDocument,
      variables,
      data: {
        postsByTag: buildPaginatedPosts(["tag-1"]),
      },
    });

    expect(cache.readQuery({ query: PostsByTagDocument, variables })).not.toBeNull();

    invalidatePostListCaches(cache);

    expect(cache.readQuery({ query: PostsByTagDocument, variables })).toBeNull();
  });

  it("removes stale search result cache entries", () => {
    const cache = buildApolloCache();
    const variables = { query: "alpha", page: 1, limit: 6 };

    cache.writeQuery({
      query: SearchPostsDocument,
      variables,
      data: {
        searchPosts: {
          __typename: "SearchResult",
          hits: [buildPostCard("search-1")],
          total: 1,
        },
      },
    });

    expect(cache.readQuery({ query: SearchPostsDocument, variables })).not.toBeNull();

    invalidatePostListCaches(cache);

    expect(cache.readQuery({ query: SearchPostsDocument, variables })).toBeNull();
  });

  it("removes stale user post list cache entries", () => {
    const cache = buildApolloCache();
    const variables = { page: 1, limit: 3 };

    cache.writeQuery({
      query: MyPostsDocument,
      variables,
      data: {
        me: {
          __typename: "User",
          id: "author-1",
          posts: buildPaginatedPosts(["mine-1"]),
        },
      },
    });

    expect(cache.readQuery({ query: MyPostsDocument, variables })).not.toBeNull();

    invalidatePostListCaches(cache);

    expect(cache.readQuery({ query: MyPostsDocument, variables })).toBeNull();
  });

  it("removes deleted post detail and entity cache entries when a post id is provided", () => {
    const cache = buildApolloCache();
    const variables = { id: "post-1" };

    cache.writeQuery({
      query: PostDocument,
      variables,
      data: {
        post: buildPostDetail("post-1"),
      },
    });

    const postCacheId = cache.identify({ __typename: "Post", id: "post-1" });
    if (!postCacheId) throw new Error("Post cache id missing");

    expect(cache.readQuery({ query: PostDocument, variables })).not.toBeNull();
    expect(hasCacheRecord(cache, postCacheId)).toBe(true);

    invalidatePostListCaches(cache, { postId: "post-1" });

    expect(cache.readQuery({ query: PostDocument, variables })).toBeNull();
    expect(hasCacheRecord(cache, postCacheId)).toBe(false);
  });
});
