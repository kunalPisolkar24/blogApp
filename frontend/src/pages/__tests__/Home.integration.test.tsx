import { HttpResponse, graphql } from "msw";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render-with-providers";
import { server } from "@/test/server";
import { sessionStoreActions } from "@/entities/session";
import Home from "../Home";

const graphqlApi = graphql.link("http://localhost:4000/graphql");

class ResizeObserverMock {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

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

describe("Home - integration", () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  beforeEach(() => {
    sessionStoreActions.markAnonymous();
  });

  it("renders the full page with posts from the API", async () => {
    server.use(
      graphqlApi.query("Posts", () =>
        HttpResponse.json({
          data: {
            posts: buildPostsResponse([buildPost({ id: "post-1" })]),
          },
        }),
      ),
    );

    renderWithProviders(<Home />);

    expect(screen.getByText("LATEST UPDATES")).toBeInTheDocument();

    expect(
      await screen.findByRole("link", {
        name: /open blog post: optimizing neural network throughput/i,
      }),
    ).toBeInTheDocument();

    expect(screen.getByText(/marcus thorne/i)).toBeInTheDocument();
  });

  it("shows the empty state when no posts exist", async () => {
    server.use(
      graphqlApi.query("Posts", () =>
        HttpResponse.json({
          data: { posts: buildPostsResponse([], 0) },
        }),
      ),
    );

    renderWithProviders(<Home />);

    expect(
      await screen.findByText("No blog posts available yet."),
    ).toBeInTheDocument();
  });

  it("switches between the Latest and For You tabs", async () => {
    renderWithProviders(<Home />);

    expect(screen.getByText("LATEST UPDATES")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: /for you/i }));

    expect(await screen.findByText("FOR YOU")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: /latest/i }));

    expect(await screen.findByText("LATEST UPDATES")).toBeInTheDocument();
  });

  it("defaults the For You tab to the latest feed on cold start", async () => {
    server.use(
      graphqlApi.query("Posts", () =>
        HttpResponse.json({
          data: { posts: buildPostsResponse([buildPost({ id: "post-1" })]) },
        }),
      ),
    );

    renderWithProviders(<Home />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: /for you/i }));

    expect(
      await screen.findByRole("link", {
        name: /open blog post: optimizing neural network throughput/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("FOR YOU")).toBeInTheDocument();
    expect(screen.queryByText(/could not load|error/i)).not.toBeInTheDocument();
  });

  it("shows recommended posts on the For You tab for an authenticated user", async () => {
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

    renderWithProviders(<Home />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: /for you/i }));

    expect(
      await screen.findByRole("link", {
        name: /open blog post: optimizing neural network throughput/i,
      }),
    ).toBeInTheDocument();
  });
});
