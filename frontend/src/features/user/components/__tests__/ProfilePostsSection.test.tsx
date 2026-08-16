import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render-with-providers";
import { ProfilePostsSection } from "../ProfilePostsSection";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

describe("ProfilePostsSection", () => {
  it("renders loading skeleton state", () => {
    const { container } = renderWithProviders(
      <ProfilePostsSection
        blogs={[]}
        isLoading={true}
        currentPage={1}
        totalPages={1}
        totalPosts={0}
        handlePageChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Publication Index")).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("renders empty state when no blogs", () => {
    renderWithProviders(
      <ProfilePostsSection
        blogs={[]}
        isLoading={false}
        currentPage={1}
        totalPages={1}
        totalPosts={0}
        handlePageChange={vi.fn()}
      />,
    );

    expect(screen.getByText("No blogs published yet")).toBeInTheDocument();
    expect(screen.getByText("Create a Blog")).toBeInTheDocument();
  });

  it("navigates to create-blog on Create a Blog click", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <ProfilePostsSection
        blogs={[]}
        isLoading={false}
        currentPage={1}
        totalPages={1}
        totalPosts={0}
        handlePageChange={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Create a Blog"));
    expect(mockNavigate).toHaveBeenCalledWith("/create-blog");
  });

  it("renders blog list when blogs exist", () => {
    const blog = {
      id: "post-1",
      title: "My First Blog",
      snippet: "Hello world",
      author: { name: "Author" },
      tags: ["tech"],
      imageUrl: "https://example.com/img.jpg",
      publishedAt: "2024-01-01",
      likedByMe: false,
      savedByMe: false,
    };

    renderWithProviders(
      <ProfilePostsSection
        blogs={[blog]}
        isLoading={false}
        currentPage={1}
        totalPages={1}
        totalPosts={1}
        handlePageChange={vi.fn()}
      />,
    );

    expect(screen.getByText("My First Blog")).toBeInTheDocument();
  });

  it("shows singular entry count", () => {
    renderWithProviders(
      <ProfilePostsSection
        blogs={[]}
        isLoading={false}
        currentPage={1}
        totalPages={1}
        totalPosts={1}
        handlePageChange={vi.fn()}
      />,
    );

    expect(screen.getByText("1 entry authored on Topos.")).toBeInTheDocument();
  });

  it("shows plural entries count", () => {
    renderWithProviders(
      <ProfilePostsSection
        blogs={[]}
        isLoading={false}
        currentPage={1}
        totalPages={1}
        totalPosts={5}
        handlePageChange={vi.fn()}
      />,
    );

    expect(screen.getByText("5 entries authored on Topos.")).toBeInTheDocument();
  });
});
