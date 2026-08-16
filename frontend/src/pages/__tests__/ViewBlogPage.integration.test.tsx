import { forwardRef } from "react";
import { HttpResponse, graphql } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders } from "@/test/render-with-providers";
import { server } from "@/test/server";
import { sessionStoreActions } from "@/entities/session";
import ViewBlogPage from "../ViewBlogPage";

vi.mock("react-quill-new", () => {
  const ReactQuillMock = forwardRef<
    HTMLDivElement,
    { onChange?: (value: string) => void }
  >(({ onChange }, ref) => (
    <div
      data-testid="react-quill-mock"
      ref={(node) => {
        if (typeof ref === "function") {
          ref(node as unknown as Parameters<NonNullable<typeof ref>>[0]);
        } else if (ref && typeof ref === "object") {
          (ref as { current: HTMLDivElement | null }).current = node;
        }
      }}
    >
      <textarea
        data-testid="react-quill-textarea"
        onChange={(event) => onChange?.(event.target.value)}
      />
    </div>
  ));
  ReactQuillMock.displayName = "ReactQuill";
  return { default: ReactQuillMock };
});

class ResizeObserverMock {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

const graphqlApi = graphql.link("http://localhost:4000/graphql");

const buildPostDetail = (overrides: Record<string, unknown> = {}) => ({
  __typename: "Post" as const,
  id: "post-123",
  title: "Test Post Title",
  body: "<p>Test content</p>",
  slug: "test-post-title",
  imageUrl: "https://images.example.com/post.jpg",
  summary: "A test summary",
  summaryStatus: "READY",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-02T00:00:00Z",
  author: {
    __typename: "User" as const,
    id: "author-1",
    username: "testauthor",
    email: "test@example.com",
    name: "Test Author",
    bio: "A test bio",
    avatarUrl: null,
  },
  tags: [
    { __typename: "Tag" as const, id: "tag-1", name: "Architecture" },
  ],
  ...overrides,
});

const currentUser = {
  __typename: "User" as const,
  id: "author-1",
  username: "testauthor",
  email: "test@example.com",
  name: "Test Author",
  bio: "A test bio",
  avatarUrl: null,
  bannerUrl: null,
  createdAt: "2024-01-01T00:00:00Z",
};

describe("ViewBlogPage - integration", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    sessionStoreActions.markAuthenticated("test-token");
    server.use(
      graphqlApi.mutation("RecordPostView", () =>
        HttpResponse.json({ data: { recordPostView: true } }),
      ),
    );
  });

  it("loads and displays a blog post in reading view", async () => {
    server.use(
      graphqlApi.query("Post", () =>
        HttpResponse.json({
          data: {
            post: buildPostDetail(),
          },
        }),
      ),
      graphqlApi.query("Me", () =>
        HttpResponse.json({
          data: { me: currentUser },
        }),
      ),
    );

    renderWithProviders(
      <Routes>
        <Route path="/blog/:id" element={<ViewBlogPage />} />
      </Routes>,
      { route: "/blog/post-123" },
    );

    expect(await screen.findByText("Test Post Title")).toBeInTheDocument();
    expect(screen.getByText("A test bio")).toBeInTheDocument();
    expect(screen.getByText("@testauthor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /update blog/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete blog/i })).toBeInTheDocument();
  });

  it("shows the not-found state when the post does not exist", async () => {
    server.use(
      graphqlApi.query("Post", () =>
        HttpResponse.json({
          data: { post: null },
        }),
      ),
      graphqlApi.query("Me", () =>
        HttpResponse.json({
          data: { me: currentUser },
        }),
      ),
    );

    renderWithProviders(
      <Routes>
        <Route path="/blog/:id" element={<ViewBlogPage />} />
      </Routes>,
      { route: "/blog/nonexistent" },
    );

    expect(
      await screen.findByText("Blog post not found."),
    ).toBeInTheDocument();
  });

  it("switches to edit mode when the author clicks update", async () => {
    const user = userEvent.setup();

    server.use(
      graphqlApi.query("Post", () =>
        HttpResponse.json({
          data: {
            post: buildPostDetail(),
          },
        }),
      ),
      graphqlApi.query("Me", () =>
        HttpResponse.json({
          data: { me: currentUser },
        }),
      ),
    );

    renderWithProviders(
      <Routes>
        <Route path="/blog/:id" element={<ViewBlogPage />} />
      </Routes>,
      { route: "/blog/post-123" },
    );

    await screen.findByText("Test Post Title");

    await user.click(screen.getByRole("button", { name: /update blog/i }));

    expect(
      await screen.findByText("Revision Console"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Revise your Topos post."),
    ).toBeInTheDocument();
  });

  it("deletes a post and redirects to the home page", async () => {
    const user = userEvent.setup();

    server.use(
      graphqlApi.query("Post", () =>
        HttpResponse.json({
          data: {
            post: buildPostDetail(),
          },
        }),
      ),
      graphqlApi.query("Me", () =>
        HttpResponse.json({
          data: { me: currentUser },
        }),
      ),
      graphqlApi.mutation("DeletePost", () =>
        HttpResponse.json({ data: { deletePost: true } }),
      ),
    );

    renderWithProviders(
      <Routes>
        <Route path="/blog/:id" element={<ViewBlogPage />} />
        <Route path="/" element={<div>Home Page After Delete</div>} />
      </Routes>,
      { route: "/blog/post-123" },
    );

    await screen.findByText("Test Post Title");

    await user.click(screen.getByRole("button", { name: /delete blog/i }));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Delete this post?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Home Page After Delete"),
      ).toBeInTheDocument();
    });
  });

  it("shows the loading skeleton while the post is being fetched", async () => {
    server.use(
      graphqlApi.query("Post", async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return HttpResponse.json({
          data: {
            post: buildPostDetail(),
          },
        });
      }),
      graphqlApi.query("Me", () =>
        HttpResponse.json({
          data: { me: currentUser },
        }),
      ),
    );

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/blog/:id" element={<ViewBlogPage />} />
      </Routes>,
      { route: "/blog/post-123" },
    );

    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0);

    expect(
      await screen.findByText("Test Post Title"),
    ).toBeInTheDocument();
  });

  it("reports a post view once per session when the post loads", async () => {
    let viewCalls = 0;
    server.use(
      graphqlApi.query("Post", () =>
        HttpResponse.json({
          data: {
            post: buildPostDetail(),
          },
        }),
      ),
      graphqlApi.query("Me", () =>
        HttpResponse.json({
          data: { me: currentUser },
        }),
      ),
      graphqlApi.mutation("RecordPostView", ({ variables }) => {
        expect(variables).toEqual({ postId: "post-123" });
        viewCalls += 1;
        return HttpResponse.json({ data: { recordPostView: true } });
      }),
    );

    const first = renderWithProviders(
      <Routes>
        <Route path="/blog/:id" element={<ViewBlogPage />} />
      </Routes>,
      { route: "/blog/post-123" },
    );
    await screen.findByText("Test Post Title");
    await waitFor(
      () => {
        expect(viewCalls).toBe(1);
      },
      { timeout: 3000 },
    );

    first.unmount();
    renderWithProviders(
      <Routes>
        <Route path="/blog/:id" element={<ViewBlogPage />} />
      </Routes>,
      { route: "/blog/post-123" },
    );
    await screen.findByText("Test Post Title");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(viewCalls).toBe(1);
  });
});
