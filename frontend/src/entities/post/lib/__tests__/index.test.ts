import { describe, expect, it } from "vitest";
import {
  BLOG_CARD_SNIPPET_ELLIPSIS,
  BLOG_CARD_SNIPPET_MAX_CHARS,
  buildSearchPagination,
  formatBlogCardDate,
  formatBlogCardTag,
  getAuthorDisplayName,
  mapPostToBlogCardItem,
  normalizeTags,
  stripHtml,
  toPlainText,
  truncateSnippet,
} from "../index";

describe("toPlainText", () => {
  it("strips html tags and normalizes whitespace", () => {
    expect(toPlainText("<p>Hello&nbsp;world</p><p>foo   bar</p>")).toBe(
      "Hello world foo bar",
    );
  });

  it("returns empty string for empty input", () => {
    expect(toPlainText("")).toBe("");
  });
});

describe("normalizeTags", () => {
  it("trims, dedupes, and drops empty strings", () => {
    expect(normalizeTags(["react ", "  react", "typescript", ""])).toEqual([
      "react",
      "typescript",
    ]);
  });
});

describe("stripHtml", () => {
  it("strips simple tags", () => {
    expect(stripHtml("<p>hello</p>")).toBe("hello");
  });
});

describe("getAuthorDisplayName", () => {
  it("falls back to username when name is empty", () => {
    expect(getAuthorDisplayName({ username: "kunal", name: "" })).toBe("kunal");
  });

  it("prefers trimmed name when present", () => {
    expect(
      getAuthorDisplayName({ username: "kunal", name: "  Kunal  " }),
    ).toBe("Kunal");
  });
});

describe("formatBlogCardDate", () => {
  it("formats ISO date into uppercased US short format", () => {
    expect(formatBlogCardDate("2024-05-12T00:00:00Z")).toBe("MAY 12, 2024");
  });

  it("returns null for invalid date input", () => {
    expect(formatBlogCardDate("not a date")).toBeNull();
  });
});

describe("formatBlogCardTag", () => {
  it("normalizes whitespace, strips leading hashes, and uppercases", () => {
    expect(formatBlogCardTag("##hello world")).toBe("#HELLO_WORLD");
  });
});

describe("truncateSnippet", () => {
  it("returns text unchanged when within the limit", () => {
    const text = "A short snippet that fits.";
    expect(truncateSnippet(text, 100)).toBe(text);
  });

  it("returns text unchanged when exactly at the limit", () => {
    const text = "x".repeat(50);
    expect(truncateSnippet(text, 50)).toBe(text);
  });

  it("cuts at the last whitespace before the limit and appends an ellipsis", () => {
    const text = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    const out = truncateSnippet(text, 20);
    expect(out.endsWith(BLOG_CARD_SNIPPET_ELLIPSIS)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(24);
    expect(out).toBe("alpha beta gamma...");
  });

  it("hard-cuts at the limit when no whitespace is found in the window", () => {
    const text = "a".repeat(200);
    const out = truncateSnippet(text, 50);
    expect(out).toBe(`${"a".repeat(50)}${BLOG_CARD_SNIPPET_ELLIPSIS}`);
  });

  it("returns an empty string for empty or whitespace-only input", () => {
    expect(truncateSnippet("", 50)).toBe("");
    expect(truncateSnippet("   \n\t  ", 50)).toBe("");
  });

  it("trims surrounding whitespace before evaluating length", () => {
    const text = "   short snippet   ";
    expect(truncateSnippet(text, 100)).toBe("short snippet");
  });
});

describe("mapPostToBlogCardItem", () => {
  it("maps a post to a view-model and truncates the snippet at the last word boundary", () => {
    const longBody = `${"word ".repeat(200)}`.trim();
    const item = mapPostToBlogCardItem({
      id: "1",
      title: "Title",
      body: `<p>${longBody}</p>`,
      imageUrl: "https://cdn/img.jpg",
      createdAt: "2024-05-12T00:00:00Z",
      likedByMe: false,
      savedByMe: false,
      author: { username: "kunal", name: "Kunal" },
      tags: [{ name: "react" }, { name: "type" }],
    });
    expect(item.id).toBe("1");
    expect(item.title).toBe("Title");
    expect(item.snippet.endsWith(BLOG_CARD_SNIPPET_ELLIPSIS)).toBe(true);
    expect(item.snippet.length).toBeLessThanOrEqual(
      BLOG_CARD_SNIPPET_MAX_CHARS + BLOG_CARD_SNIPPET_ELLIPSIS.length,
    );
    expect(item.author.name).toBe("Kunal");
    expect(item.tags).toEqual(["react", "type"]);
    expect(item.imageUrl).toBe("https://cdn/img.jpg");
    expect(item.publishedAt).toBe("2024-05-12T00:00:00Z");
  });

  it("leaves the snippet untouched when the body is already short", () => {
    const shortBody = "A brief, self-contained post body.";
    const item = mapPostToBlogCardItem({
      id: "1",
      title: "Title",
      body: `<p>${shortBody}</p>`,
      imageUrl: "https://cdn/img.jpg",
      createdAt: "2024-05-12T00:00:00Z",
      likedByMe: false,
      savedByMe: false,
      author: { username: "u", name: "U" },
      tags: [],
    });
    expect(item.snippet).toBe(shortBody);
    expect(item.snippet.endsWith(BLOG_CARD_SNIPPET_ELLIPSIS)).toBe(false);
  });

  it("falls back to default image when missing", () => {
    const item = mapPostToBlogCardItem({
      id: "1",
      title: "t",
      body: "b",
      imageUrl: null,
      createdAt: "2024-05-12T00:00:00Z",
      likedByMe: false,
      savedByMe: false,
      author: { username: "u" },
      tags: [],
    });
    expect(item.imageUrl).toMatch(/^https:\/\/images\.unsplash\.com/);
  });
});

describe("buildSearchPagination", () => {
  it("computes total pages with a minimum of 1", () => {
    expect(buildSearchPagination(0, 1, 6)).toEqual({
      currentPage: 1,
      totalPages: 1,
      totalResults: 0,
    });
    expect(buildSearchPagination(12, 2, 6)).toEqual({
      currentPage: 2,
      totalPages: 2,
      totalResults: 12,
    });
  });
});
