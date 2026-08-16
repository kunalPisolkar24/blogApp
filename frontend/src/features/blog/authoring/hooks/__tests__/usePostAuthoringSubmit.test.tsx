import { HttpResponse, graphql } from "msw";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ApolloProvider } from "@apollo/client/react";
import { MemoryRouter } from "react-router-dom";
import type { ApolloClient } from "@apollo/client";
import { server } from "@/test/server";
import { createApolloClient, POST_LIST_QUERY_NAMES } from "@/shared/api";
import { env } from "@/shared/config/env";
import { PostsDocument } from "@/shared/graphql/content-documents";
import { usePostAuthoringSubmit } from "../usePostAuthoringSubmit";

const noopUnauthorized = async () => {};

function makeWrapper() {
  const clientRef: { current: ApolloClient | null } = { current: null };
  const wrapper = ({ children }: { children: ReactNode }) => {
    if (clientRef.current === null) {
      clientRef.current = createApolloClient({
        uri: env.VITE_GRAPHQL_URL,
        getToken: () => null,
        onUnauthorized: noopUnauthorized,
      });
    }
    return (
      <ApolloProvider client={clientRef.current}>
        <MemoryRouter initialEntries={["/"]}>{children}</MemoryRouter>
      </ApolloProvider>
    );
  };
  return wrapper;
}

const baseArgs = {
  title: "A title",
  content: "<p>body</p>",
  contentText: "body",
  imageFile: null as File | null,
  imageUrl: "https://x/y.png",
  tags: ["alpha"],
  summary: null as string | null,
  uploadCardImage: () => Promise.resolve<string | null>("https://x/y.png"),
};

const postListVariables = { page: 1, limit: 6 };

const buildPaginatedPosts = (id: string) => ({
  __typename: "PaginatedPosts" as const,
  posts: [
    {
      __typename: "Post" as const,
      id,
      title: `Post ${id}`,
      body: "<p>body</p>",
      imageUrl: "https://x/y.png",
      createdAt: "2024-01-01T00:00:00Z",
      likedByMe: false,
      savedByMe: false,
      author: {
        __typename: "User" as const,
        id: "author-1",
        username: "alice",
        name: "Alice",
        avatarUrl: null,
      },
      tags: [
        {
          __typename: "Tag" as const,
          id: "tag-1",
          name: "alpha",
        },
      ],
    },
  ],
  totalPages: 1,
  currentPage: 1,
  totalPosts: 1,
});

const writeStalePostsCache = (client: ApolloClient, id: string) => {
  client.writeQuery({
    query: PostsDocument,
    variables: postListVariables,
    data: {
      posts: buildPaginatedPosts(id),
    },
  });
};

describe("usePostAuthoringSubmit", () => {
  const wrapper = makeWrapper();

  it("starts in the idle state", () => {
    const { result } = renderHook(
      () => usePostAuthoringSubmit({ ...baseArgs, mode: "create" }),
      { wrapper },
    );
    expect(result.current.submit).toEqual({ kind: "idle" });
  });

  it("blocks create when title or content is missing", async () => {
    const { result } = renderHook(
      () =>
        usePostAuthoringSubmit({
          ...baseArgs,
          mode: "create",
          title: "  ",
          content: "<p>body</p>",
          contentText: "body",
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: () => {},
      } as unknown as React.FormEvent);
    });
    expect(result.current.submit).toEqual({ kind: "idle" });
  });

  it("blocks create when there is no image and no upload helper returns null", async () => {
    const { result } = renderHook(
      () =>
        usePostAuthoringSubmit({
          ...baseArgs,
          mode: "create",
          imageUrl: null,
          imageFile: null,
          uploadCardImage: () => Promise.resolve<string | null>(null),
        }),
      { wrapper },
    );
    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: () => {},
      } as unknown as React.FormEvent);
    });
    expect(result.current.submit).toEqual({ kind: "idle" });
  });

  it("transitions through uploading then creating on successful create", async () => {
    const graphqlApi = graphql.link("http://localhost:4000/graphql");
    server.use(
      graphqlApi.mutation("CreatePost", () =>
        HttpResponse.json({ data: { createPost: { __typename: "Post", id: "1" } } }),
      ),
    );

    const { result } = renderHook(
      () =>
        usePostAuthoringSubmit({
          ...baseArgs,
          mode: "create",
          imageUrl: null,
          imageFile: new File([new Uint8Array([1, 2, 3])], "card.png", { type: "image/png" }),
          uploadCardImage: () => Promise.resolve<string | null>("https://cdn/ok.png"),
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: () => {},
      } as unknown as React.FormEvent);
    });

    expect(result.current.submit).toEqual({ kind: "idle" });
  });

  it("creates a post directly when the image url is already known", async () => {
    const graphqlApi = graphql.link("http://localhost:4000/graphql");
    let receivedImageUrl: string | undefined;
    server.use(
      graphqlApi.mutation("CreatePost", async ({ request }) => {
        const body = (await request.json()) as unknown as {
          variables?: { input?: { imageUrl?: string } };
        };
        receivedImageUrl = body.variables?.input?.imageUrl;
        return HttpResponse.json({
          data: { createPost: { __typename: "Post", id: "2" } },
        });
      }),
    );

    const { result } = renderHook(
      () =>
        usePostAuthoringSubmit({
          ...baseArgs,
          mode: "create",
          imageUrl: "https://cdn/preset.png",
          imageFile: null,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: () => {},
      } as unknown as React.FormEvent);
    });

    await waitFor(() => {
      expect(receivedImageUrl).toBe("https://cdn/preset.png");
    });
  });

  it("transitions to error when the create mutation fails", async () => {
    const graphqlApi = graphql.link("http://localhost:4000/graphql");
    server.use(
      graphqlApi.mutation("CreatePost", () =>
        HttpResponse.json({
          errors: [{ message: "Server failed", locations: undefined, path: ["createPost"] }],
          data: { createPost: null },
        }),
      ),
    );

    const { result } = renderHook(
      () => usePostAuthoringSubmit({ ...baseArgs, mode: "create" }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: () => {},
      } as unknown as React.FormEvent);
    });

    await waitFor(() => {
      expect(result.current.submit.kind).toBe("error");
    });
  });

  it("returns to idle when validation fails for the create input", async () => {
    const graphqlApi = graphql.link("http://localhost:4000/graphql");
    let called = 0;
    server.use(
      graphqlApi.mutation("CreatePost", () => {
        called += 1;
        return HttpResponse.json({ data: { createPost: null } });
      }),
    );

    const { result } = renderHook(
      () =>
        usePostAuthoringSubmit({
          ...baseArgs,
          mode: "create",
          tags: ["   "],
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: () => {},
      } as unknown as React.FormEvent);
    });

    expect(called).toBe(0);
    expect(result.current.submit).toEqual({ kind: "idle" });
  });

  it("transitions through updating on successful edit", async () => {
    const graphqlApi = graphql.link("http://localhost:4000/graphql");
    let receivedId: string | undefined;
    let receivedTitle: string | undefined;
    server.use(
      graphqlApi.mutation("UpdatePost", async ({ request }) => {
        const body = (await request.json()) as unknown as {
          variables?: { id?: string; input?: { title?: string } };
        };
        receivedId = body.variables?.id;
        receivedTitle = body.variables?.input?.title;
        return HttpResponse.json({
          data: { updatePost: { __typename: "Post", id: "abc" } },
        });
      }),
    );

    const onComplete = vi.fn();
    const { result } = renderHook(
      () =>
        usePostAuthoringSubmit({
          ...baseArgs,
          mode: "edit",
          title: "New title",
          content: "<p>new body</p>",
          post: {
            id: "abc",
            title: "old title",
            body: "<p>old body</p>",
            imageUrl: "https://x/y.png",
            tags: [{ id: "t1", name: "alpha" }],
          },
          onComplete,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: () => {},
      } as unknown as React.FormEvent);
    });

    await waitFor(() => {
      expect(receivedId).toBe("abc");
    });
    expect(receivedTitle).toBe("New title");
    expect(onComplete).toHaveBeenCalled();
    expect(result.current.submit).toEqual({ kind: "idle" });
  });

  it("returns to idle and calls onComplete when there are no changes", async () => {
    const onComplete = vi.fn();
    const { result } = renderHook(
      () =>
        usePostAuthoringSubmit({
          ...baseArgs,
          mode: "edit",
          title: "same",
          content: "<p>body</p>",
          post: {
            id: "abc",
            title: "same",
            body: "<p>body</p>",
            imageUrl: "https://x/y.png",
            tags: [{ id: "t1", name: "alpha" }],
          },
          onComplete,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: () => {},
      } as unknown as React.FormEvent);
    });

    expect(onComplete).toHaveBeenCalled();
    expect(result.current.submit).toEqual({ kind: "idle" });
  });

  it("refreshes post list queries and invalidates stale feed cache after a successful create", async () => {
    const graphqlApi = graphql.link("http://localhost:4000/graphql");
    server.use(
      graphqlApi.mutation("CreatePost", () =>
        HttpResponse.json({
          data: { createPost: { __typename: "Post", id: "1" } },
        }),
      ),
    );

    const localClient = createApolloClient({
      uri: env.VITE_GRAPHQL_URL,
      getToken: () => null,
      onUnauthorized: noopUnauthorized,
    });
    const refetchSpy = vi.spyOn(localClient, "refetchQueries");
    writeStalePostsCache(localClient, "stale-create");

    expect(
      localClient.readQuery({
        query: PostsDocument,
        variables: postListVariables,
      }),
    ).not.toBeNull();

    const localWrapper = ({ children }: { children: ReactNode }) => (
      <ApolloProvider client={localClient}>
        <MemoryRouter initialEntries={["/"]}>{children}</MemoryRouter>
      </ApolloProvider>
    );

    const { result } = renderHook(
      () => usePostAuthoringSubmit({ ...baseArgs, mode: "create" }),
      { wrapper: localWrapper },
    );

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: () => {},
      } as unknown as React.FormEvent);
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
  });

  it("refreshes post list queries and invalidates stale feed cache after a successful update", async () => {
    const graphqlApi = graphql.link("http://localhost:4000/graphql");
    server.use(
      graphqlApi.mutation("UpdatePost", () =>
        HttpResponse.json({
          data: { updatePost: { __typename: "Post", id: "abc" } },
        }),
      ),
    );

    const localClient = createApolloClient({
      uri: env.VITE_GRAPHQL_URL,
      getToken: () => null,
      onUnauthorized: noopUnauthorized,
    });
    const refetchSpy = vi.spyOn(localClient, "refetchQueries");
    writeStalePostsCache(localClient, "stale-update");

    expect(
      localClient.readQuery({
        query: PostsDocument,
        variables: postListVariables,
      }),
    ).not.toBeNull();

    const localWrapper = ({ children }: { children: ReactNode }) => (
      <ApolloProvider client={localClient}>
        <MemoryRouter initialEntries={["/"]}>{children}</MemoryRouter>
      </ApolloProvider>
    );

    const { result } = renderHook(
      () =>
        usePostAuthoringSubmit({
          ...baseArgs,
          mode: "edit",
          title: "New title",
          content: "<p>new body</p>",
          post: {
            id: "abc",
            title: "old title",
            body: "<p>old body</p>",
            imageUrl: "https://x/y.png",
            tags: [{ id: "t1", name: "alpha" }],
          },
        }),
      { wrapper: localWrapper },
    );

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: () => {},
      } as unknown as React.FormEvent);
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
  });
});
