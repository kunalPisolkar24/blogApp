import { HttpResponse, graphql } from "msw";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render-with-providers";
import { server } from "@/test/server";
import { sessionStoreActions } from "@/entities/session";
import { ForYouList } from "../ForYouList";

const graphqlApi = graphql.link("http://localhost:4000/graphql");

const buildPost = (overrides: Record<string, unknown> = {}) => ({
  __typename: "Post" as const,
  id: "post-1",
  title: "Optimizing Neural Network Throughput for Low-Latency Architectures",
  body: "<p>Kernel-level optimizations for inference workloads.</p>",
  imageUrl: "https://images.example.com/post-1.jpg",
  createdAt: "2023-10-24T12:00:00.000Z",
  author: {
    __typename: "User" as const,
    id: "author-1",
    username: "marcusthorne",
    name: "Marcus Thorne",
    avatarUrl: null,
  },
  tags: [
    {
      __typename: "Tag" as const,
      id: "tag-1",
      name: "Architecture",
    },
  ],
  ...overrides,
});

const buildPostsResponse = (posts: unknown[] = [buildPost()], totalPosts = 1) => ({
  __typename: "PaginatedPosts",
  posts,
  totalPages: Math.ceil(totalPosts / 6),
  currentPage: 1,
  totalPosts,
});

describe("ForYouList", () => {
  afterEach(() => {
    sessionStoreActions.markAnonymous();
  });

  it("shows the latest feed for an anonymous user with no error surfaced", async () => {
    server.use(
      graphqlApi.query("RecommendedPosts", () =>
        HttpResponse.json({ errors: [{ message: "unauthorized" }] }),
      ),
      graphqlApi.query("Posts", () =>
        HttpResponse.json({
          data: { posts: buildPostsResponse([buildPost({ id: "latest-post" })]) },
        }),
      ),
    );

    renderWithProviders(<ForYouList />);

    expect(screen.getByText("FOR YOU")).toBeInTheDocument();
    expect(
      await screen.findByRole("link", {
        name: /open blog post: optimizing neural network throughput/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/could not load|error/i),
    ).not.toBeInTheDocument();
  });

  it("renders recommended posts for an authenticated user", async () => {
    sessionStoreActions.markAuthenticated("test-token");
    server.use(
      graphqlApi.query("RecommendedPosts", () =>
        HttpResponse.json({
          data: {
            recommendedPosts: buildPostsResponse([
              buildPost({ id: "recommended-post" }),
            ]),
          },
        }),
      ),
    );

    renderWithProviders(<ForYouList />);

    expect(
      await screen.findByRole("link", {
        name: /open blog post: optimizing neural network throughput/i,
      }),
    ).toBeInTheDocument();
  });

  it("falls back to the latest feed without an error when the AI feed fails", async () => {
    sessionStoreActions.markAuthenticated("test-token");
    server.use(
      graphqlApi.query("RecommendedPosts", () =>
        HttpResponse.json({ errors: [{ message: "Server error" }] }),
      ),
      graphqlApi.query("Posts", () =>
        HttpResponse.json({
          data: { posts: buildPostsResponse([buildPost({ id: "fallback-post" })]) },
        }),
      ),
    );

    renderWithProviders(<ForYouList />);

    expect(
      await screen.findByRole("link", {
        name: /open blog post: optimizing neural network throughput/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/could not load|server error/i)).not.toBeInTheDocument();
  });

  it("falls back to the latest feed when the AI feed is empty on cold start", async () => {
    sessionStoreActions.markAuthenticated("test-token");
    server.use(
      graphqlApi.query("RecommendedPosts", () =>
        HttpResponse.json({
          data: { recommendedPosts: buildPostsResponse([], 0) },
        }),
      ),
      graphqlApi.query("Posts", () =>
        HttpResponse.json({
          data: { posts: buildPostsResponse([buildPost({ id: "fallback-post" })]) },
        }),
      ),
    );

    renderWithProviders(<ForYouList />);

    expect(
      await screen.findByRole("link", {
        name: /open blog post: optimizing neural network throughput/i,
      }),
    ).toBeInTheDocument();
  });

  it("re-queries with surprise mode and a fresh seed on the surprise button", async () => {
    sessionStoreActions.markAuthenticated("test-token");
    let requestCount = 0;
    const requests: { mode?: string; seed?: number }[] = [];
    server.use(
      graphqlApi.query("RecommendedPosts", ({ variables }) => {
        requestCount += 1;
        requests.push({ mode: variables?.mode, seed: variables?.seed });
        return HttpResponse.json({
          data: {
            recommendedPosts: buildPostsResponse([
              buildPost({ id: "recommended-post" }),
            ]),
          },
        });
      }),
    );

    renderWithProviders(<ForYouList />);

    await screen.findByRole("link", {
      name: /open blog post: optimizing neural network throughput/i,
    });

    fireEvent.click(screen.getByRole("button", { name: /surprise me/i }));

    await waitFor(() => {
      expect(requestCount).toBeGreaterThanOrEqual(2);
    });
    const firstRequest = requests[0];
    const surpriseRequest = requests[requests.length - 1];
    expect(firstRequest?.mode).toBe("DEFAULT");
    expect(surpriseRequest?.mode).toBe("SURPRISE");
    expect(surpriseRequest?.seed).not.toBe(firstRequest?.seed);
  });
});