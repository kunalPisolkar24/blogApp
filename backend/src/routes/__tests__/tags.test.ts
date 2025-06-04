import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { tagRouter, type TagHonoEnv } from "../tags";
import { StatusCode } from "../../constants/status-code";
import type { Tag, Post } from "@prisma/client";

const mockTagMethods = { findMany: vi.fn() };
const mockPostMethods = { findMany: vi.fn(), count: vi.fn() };

const mockPrismaInstance = {
  tag: mockTagMethods,
  post: mockPostMethods,
  $disconnect: vi.fn(),
  $extends: vi.fn(),
};

vi.mock("@prisma/client/edge", () => ({
  PrismaClient: vi.fn(() => mockPrismaInstance),
}));

vi.mock("@prisma/extension-accelerate", () => ({
  withAccelerate: vi.fn(() => (client: any) => client),
}));

const mockEnv: TagHonoEnv["Bindings"] = {
  DATABASE_URL: "mock_db_url_for_tags",
  JWT_SECRET: "mock_jwt_secret_not_used_by_tagRouter",
  DATABASE_URL_MIGRATE: "mock_migrate_url",
  UPSTASH_REDIS_REST_URL: "mock_upstash_url",
  UPSTASH_REDIS_REST_TOKEN: "mock_upstash_token",
  RAILWAY_CONSUMER_WAKEUP_URL: "mock_railway_url",
  RAILWAY_WAKEUP_SECRET: "mock_railway_secret",
  UPSTASH_RATELIMIT_REDIS_REST_URL: "mock_ratelimit_url",
  UPSTASH_RATELIMIT_REDIS_REST_TOKEN: "mock_ratelimit_token",
};

const app = new Hono<{ Bindings: TagHonoEnv["Bindings"] }>();
app.route("/", tagRouter);

interface ErrorResponse {
  error: string;
}
interface TagResponseItem extends Tag {}

interface PostWithAuthorAndTags
  extends Omit<Post, "authorId" | "createdAt" | "updatedAt"> {
  createdAt: string;
  updatedAt: string;
  author: { id: number; username: string; email: string };
  tags: { tag: Tag }[];
}
interface GetPostsByTagResponse {
  data: PostWithAuthorAndTags[];
  totalPages: number;
  currentPage: number;
  totalPosts: number;
}

describe("Tag Router (tag.ts)", () => {
  const testDate = new Date();
  const testDateISO = testDate.toISOString();
  const tagName = "Tech";

  const mockPosts: PostWithAuthorAndTags[] = [
    {
      id: 1,
      title: "Post 1",
      body: "Body 1",
      imageUrl: null,
      summary: null,
      summaryStatus: null,
      createdAt: testDateISO,
      updatedAt: testDateISO,
      author: { id: 1, username: "Author1", email: "a1@example.com" },
      tags: [{ tag: { id: 1, name: "Tech" } }],
    },
    {
      id: 2,
      title: "Post 2",
      body: "Body 2",
      imageUrl: null,
      summary: null,
      summaryStatus: null,
      createdAt: testDateISO,
      updatedAt: testDateISO,
      author: { id: 2, username: "Author2", email: "a2@example.com" },
      tags: [{ tag: { id: 1, name: "Tech" } }],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaInstance.$extends
      .mockReset()
      .mockImplementation(() => mockPrismaInstance);
    mockPrismaInstance.$disconnect.mockReset().mockResolvedValue(undefined);
    mockTagMethods.findMany.mockReset();
    mockPostMethods.findMany.mockReset();
    mockPostMethods.count.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET / (fetch tags)", () => {
    const defaultLimit = 4;
    const mockLocalTags: Tag[] = [
      { id: 1, name: "Tech" },
      { id: 2, name: "Travel" },
      { id: 3, name: "Food" },
      { id: 4, name: "Lifestyle" },
    ];

    it("should fetch tags with default limit and order when no query is provided", async () => {
      mockTagMethods.findMany.mockResolvedValue(
        mockLocalTags.slice(0, defaultLimit)
      );
      const request = new Request("http://localhost/", { method: "GET" });
      const response = await app.fetch(request, mockEnv);
      const body = (await response.json()) as TagResponseItem[];
      expect(response.status).toBe(StatusCode.OK);
      expect(mockTagMethods.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: defaultLimit,
          orderBy: { name: "asc" },
        })
      );
      const actualArgs = mockTagMethods.findMany.mock.calls[0][0];
      expect(actualArgs.where).toBeUndefined();
      expect(body).toEqual(mockLocalTags.slice(0, defaultLimit));
    });

    it("should fetch tags with search query, limit, and order", async () => {
      const searchQuery = "Te";
      const filteredMockTags = mockLocalTags.filter((tag) =>
        tag.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
      mockTagMethods.findMany.mockResolvedValue(filteredMockTags);
      const request = new Request(`http://localhost/?query=${searchQuery}`, {
        method: "GET",
      });
      const response = await app.fetch(request, mockEnv);
      const body = (await response.json()) as TagResponseItem[];
      expect(response.status).toBe(StatusCode.OK);
      expect(mockTagMethods.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            name: {
              contains: searchQuery.trim(),
              mode: "insensitive",
            },
          },
          take: defaultLimit,
          orderBy: { name: "asc" },
        })
      );
      expect(body).toEqual(filteredMockTags);
    });

    it("should handle empty search query as no query", async () => {
      mockTagMethods.findMany.mockResolvedValue(
        mockLocalTags.slice(0, defaultLimit)
      );
      const request = new Request("http://localhost/?query=", {
        method: "GET",
      });
      const response = await app.fetch(request, mockEnv);
      await response.json();
      expect(response.status).toBe(StatusCode.OK);
      expect(mockTagMethods.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: defaultLimit,
          orderBy: { name: "asc" },
        })
      );
      const actualArgs = mockTagMethods.findMany.mock.calls[0][0];
      expect(actualArgs.where).toBeUndefined();
    });

    it("should return 500 if Prisma fails to fetch tags", async () => {
      const errorMessage = "Prisma findMany for tags failed";
      mockTagMethods.findMany.mockRejectedValue(new Error(errorMessage));
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const request = new Request("http://localhost/", { method: "GET" });
      const response = await app.fetch(request, mockEnv);
      const body = (await response.json()) as ErrorResponse;
      expect(response.status).toBe(StatusCode.INTERNAL_SERVER_ERROR);
      expect(body.error).toBe("Failed to get tags");
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toBe("Failed to get tags:");
      expect(consoleErrorSpy.mock.calls[0][1]).toBeInstanceOf(Error);
      expect((consoleErrorSpy.mock.calls[0][1] as Error).message).toBe(
        errorMessage
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe("GET /getPost/:tag (fetch posts by tag)", () => {
    const defaultPage = 1;
    const defaultLimit = 6;

    it("should fetch posts for a given tag with default pagination", async () => {
      mockPostMethods.findMany.mockResolvedValue(mockPosts);
      mockPostMethods.count.mockResolvedValue(mockPosts.length);
      const request = new Request(`http://localhost/getPost/${tagName}`, {
        method: "GET",
      });
      const response = await app.fetch(request, mockEnv);
      const body = (await response.json()) as GetPostsByTagResponse;
      expect(response.status).toBe(StatusCode.OK);
      expect(mockPostMethods.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tags: { some: { tag: { name: tagName } } } },
          skip: (defaultPage - 1) * defaultLimit,
          take: defaultLimit,
          include: expect.any(Object),
          orderBy: { id: "desc" },
        })
      );
      expect(mockPostMethods.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tags: { some: { tag: { name: tagName } } } },
        })
      );
      expect(body.data).toEqual(mockPosts);
      expect(body.totalPosts).toBe(mockPosts.length);
      expect(body.currentPage).toBe(defaultPage);
      expect(body.totalPages).toBe(Math.ceil(mockPosts.length / defaultLimit));
    });

    it("should fetch posts with custom page and limit", async () => {
      const page = 2;
      const limit = 1;
      const expectedSkip = (page - 1) * limit;
      const paginatedMockPosts = [mockPosts[1]];
      mockPostMethods.findMany.mockResolvedValue(paginatedMockPosts);
      mockPostMethods.count.mockResolvedValue(mockPosts.length);
      const request = new Request(
        `http://localhost/getPost/${tagName}?page=${page}&limit=${limit}`,
        { method: "GET" }
      );
      const response = await app.fetch(request, mockEnv);
      const body = (await response.json()) as GetPostsByTagResponse;
      expect(response.status).toBe(StatusCode.OK);
      expect(mockPostMethods.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: expectedSkip,
          take: limit,
        })
      );
      expect(body.data).toEqual(paginatedMockPosts);
      expect(body.currentPage).toBe(page);
      expect(body.totalPages).toBe(Math.ceil(mockPosts.length / limit));
    });

    it("should correctly calculate totalPages even with zero posts", async () => {
      mockPostMethods.findMany.mockResolvedValue([]);
      mockPostMethods.count.mockResolvedValue(0);
      const request = new Request(`http://localhost/getPost/${tagName}`, {
        method: "GET",
      });
      const response = await app.fetch(request, mockEnv);
      const body = (await response.json()) as GetPostsByTagResponse;
      expect(response.status).toBe(StatusCode.OK);
      expect(body.data).toEqual([]);
      expect(body.totalPosts).toBe(0);
      expect(body.currentPage).toBe(defaultPage);
      expect(body.totalPages).toBe(0);
    });

    it("should return 500 if Prisma fails to fetch posts (findMany fails)", async () => {
      const errorMessage = "Prisma findMany for posts failed";
      mockPostMethods.findMany.mockRejectedValue(new Error(errorMessage));
      mockPostMethods.count.mockResolvedValue(10);
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const request = new Request(`http://localhost/getPost/${tagName}`, {
        method: "GET",
      });
      const response = await app.fetch(request, mockEnv);
      const body = (await response.json()) as ErrorResponse;
      expect(response.status).toBe(StatusCode.INTERNAL_SERVER_ERROR);
      expect(body.error).toBe("Failed to get posts for the given tag");
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toBeInstanceOf(Error);
      expect((consoleErrorSpy.mock.calls[0][0] as Error).message).toBe(
        errorMessage
      );
      consoleErrorSpy.mockRestore();
    });

    it("should return 500 if Prisma fails to count posts (count fails)", async () => {
      const errorMessage = "Prisma count for posts failed";
      mockPostMethods.findMany.mockResolvedValue(mockPosts);
      mockPostMethods.count.mockRejectedValue(new Error(errorMessage));
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const request = new Request(`http://localhost/getPost/${tagName}`, {
        method: "GET",
      });
      const response = await app.fetch(request, mockEnv);
      const body = (await response.json()) as ErrorResponse;
      expect(response.status).toBe(StatusCode.INTERNAL_SERVER_ERROR);
      expect(body.error).toBe("Failed to get posts for the given tag");
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toBeInstanceOf(Error);
      expect((consoleErrorSpy.mock.calls[0][0] as Error).message).toBe(
        errorMessage
      );
      consoleErrorSpy.mockRestore();
    });
  });
});
