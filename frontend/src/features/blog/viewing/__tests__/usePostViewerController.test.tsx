import { HttpResponse, graphql } from "msw";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ApolloProvider } from "@apollo/client/react";
import { MemoryRouter } from "react-router-dom";
import type { ApolloClient } from "@apollo/client";
import { server } from "@/test/server";
import { createApolloClient, POST_LIST_QUERY_NAMES } from "@/shared/api";
import { env } from "@/shared/config/env";
import {
  MyPostsDocument,
  PostDocument,
  PostsDocument,
} from "@/shared/graphql/content-documents";
import { usePostViewerController } from "../usePostViewerController";

const noopUnauthorized = async () => {};
const postListVariables = { page: 1, limit: 6 };
const postVariables = { id: "abc" };
const myPostsVariables = { page: 1, limit: 3 };

const loadedPost = {
  __typename: "Post" as const,
  id: "abc",
  title: "Some post",
  body: "<p>body</p>",
  slug: "some-post",
  imageUrl: "https://x/y.png",
  summary: null,
  summaryStatus: "READY",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  author: {
    __typename: "User" as const,
    id: "u1",
    username: "alice",
    email: "alice@x.com",
    name: "Alice",
    bio: null,
    avatarUrl: null,
  },
  tags: [],
  related: [],
};

const staleListPost = {
  __typename: "Post" as const,
  id: "abc",
  title: "Some post",
  body: "<p>body</p>",
  imageUrl: "https://x/y.png",
  createdAt: "2024-01-01T00:00:00Z",
  author: {
    __typename: "User" as const,
    id: "u1",
    username: "alice",
    name: "Alice",
    avatarUrl: null,
  },
  tags: [],
};

const writeStalePostsCache = (client: ApolloClient) => {
  client.writeQuery({
    query: PostsDocument,
    variables: postListVariables,
    data: {
      posts: {
        __typename: "PaginatedPosts",
        posts: [staleListPost],
        totalPages: 1,
        currentPage: 1,
        totalPosts: 1,
      },
    },
  });
};

const writeStaleMyPostsCache = (client: ApolloClient) => {
  client.writeQuery({
    query: MyPostsDocument,
    variables: myPostsVariables,
    data: {
      me: {
        __typename: "User",
        id: "u1",
        posts: {
          __typename: "PaginatedPosts",
          posts: [staleListPost],
          totalPages: 1,
          currentPage: 1,
          totalPosts: 1,
        },
      },
    },
  });
};

const hasCacheRecord = (client: ApolloClient, id: string) =>
  Object.prototype.hasOwnProperty.call(client.cache.extract(false), id);

describe("usePostViewerController", () => {
  it("refreshes post list queries and invalidates stale post cache after a successful delete", async () => {
    const graphqlApi = graphql.link("http://localhost:4000/graphql");
    server.use(
      graphqlApi.query("Post", () =>
        HttpResponse.json({
          data: {
            post: loadedPost,
          },
        }),
      ),
      graphqlApi.mutation("DeletePost", () =>
        HttpResponse.json({ data: { deletePost: true } }),
      ),
    );

    const localClient = createApolloClient({
      uri: env.VITE_GRAPHQL_URL,
      getToken: () => null,
      onUnauthorized: noopUnauthorized,
    });
    const refetchSpy = vi.spyOn(localClient, "refetchQueries");
    writeStalePostsCache(localClient);

    const localWrapper = ({ children }: { children: ReactNode }) => (
      <ApolloProvider client={localClient}>
        <MemoryRouter initialEntries={["/blog/abc"]}>{children}</MemoryRouter>
      </ApolloProvider>
    );

    const { result } = renderHook(
      () => usePostViewerController("abc"),
      { wrapper: localWrapper },
    );

    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    const postCacheId = localClient.cache.identify({
      __typename: "Post",
      id: "abc",
    });
    if (!postCacheId) throw new Error("Post cache id missing");

    expect(
      localClient.readQuery({
        query: PostsDocument,
        variables: postListVariables,
      }),
    ).not.toBeNull();
    expect(
      localClient.readQuery({
        query: PostDocument,
        variables: postVariables,
      }),
    ).not.toBeNull();
    expect(hasCacheRecord(localClient, postCacheId)).toBe(true);

    await act(async () => {
      await result.current.deletePost();
    });

    expect(refetchSpy).toHaveBeenCalledWith({
      include: [...POST_LIST_QUERY_NAMES],
    });
    expect(
      localClient.readQuery({
        query: PostsDocument,
        variables: postListVariables,
      }),
    ).toBeNull();
    expect(
      localClient.readQuery({
        query: PostDocument,
        variables: postVariables,
      }),
    ).toBeNull();
    expect(hasCacheRecord(localClient, postCacheId)).toBe(false);
  });

  it("shows loading state when post is not yet loaded", () => {
    const graphqlApi = graphql.link("http://localhost:4000/graphql");
    server.use(
      graphqlApi.query("Post", async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return HttpResponse.json({ data: { post: loadedPost } });
      }),
    );

    const localClient = createApolloClient({
      uri: env.VITE_GRAPHQL_URL,
      getToken: () => null,
      onUnauthorized: noopUnauthorized,
    });

    const localWrapper = ({ children }: { children: ReactNode }) => (
      <ApolloProvider client={localClient}>
        <MemoryRouter initialEntries={["/blog/abc"]}>{children}</MemoryRouter>
      </ApolloProvider>
    );

    const { result } = renderHook(
      () => usePostViewerController("abc"),
      { wrapper: localWrapper },
    );

    expect(result.current.state.kind).toBe("loading");
  });

  it("shows not-found state when post data is missing", async () => {
    const graphqlApi = graphql.link("http://localhost:4000/graphql");
    server.use(
      graphqlApi.query("Post", () =>
        HttpResponse.json({ data: { post: null } }),
      ),
    );

    const localClient = createApolloClient({
      uri: env.VITE_GRAPHQL_URL,
      getToken: () => null,
      onUnauthorized: noopUnauthorized,
    });

    const localWrapper = ({ children }: { children: ReactNode }) => (
      <ApolloProvider client={localClient}>
        <MemoryRouter initialEntries={["/blog/nonexistent"]}>{children}</MemoryRouter>
      </ApolloProvider>
    );

    const { result } = renderHook(
      () => usePostViewerController("nonexistent"),
      { wrapper: localWrapper },
    );

    await waitFor(() => {
      expect(result.current.state.kind).toBe("not-found");
    });
  });

  it("evicts the me.posts profile cache after a successful delete", async () => {
    const graphqlApi = graphql.link("http://localhost:4000/graphql");
    server.use(
      graphqlApi.query("Post", () =>
        HttpResponse.json({
          data: {
            post: loadedPost,
          },
        }),
      ),
      graphqlApi.mutation("DeletePost", () =>
        HttpResponse.json({ data: { deletePost: true } }),
      ),
    );

    const localClient = createApolloClient({
      uri: env.VITE_GRAPHQL_URL,
      getToken: () => null,
      onUnauthorized: noopUnauthorized,
    });
    writeStaleMyPostsCache(localClient);

    const localWrapper = ({ children }: { children: ReactNode }) => (
      <ApolloProvider client={localClient}>
        <MemoryRouter initialEntries={["/blog/abc"]}>{children}</MemoryRouter>
      </ApolloProvider>
    );

    const { result } = renderHook(
      () => usePostViewerController("abc"),
      { wrapper: localWrapper },
    );

    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    const userCacheId = localClient.cache.identify({
      __typename: "User",
      id: "u1",
    });
    if (!userCacheId) throw new Error("User cache id missing");

    expect(
      localClient.readQuery({
        query: MyPostsDocument,
        variables: myPostsVariables,
      }),
    ).not.toBeNull();

    await act(async () => {
      await result.current.deletePost();
    });

    expect(
      localClient.readQuery({
        query: MyPostsDocument,
        variables: myPostsVariables,
      }),
    ).toBeNull();
  });
});
