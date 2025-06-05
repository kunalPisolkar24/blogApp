import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { postRouter, type HonoEnv } from "../posts";
import { StatusCode } from "../../constants/status-code";
import type { Post, Tag } from "@prisma/client";

const { mockAuthMiddlewareFn } = vi.hoisted(() => {
  return {
    mockAuthMiddlewareFn: vi.fn(async (c, next) => {
      c.set("user", { id: 1 });
      await next();
    }),
  };
});

vi.mock("../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddlewareFn,
}));

const mockPostMethods = {
  findMany: vi.fn(),
  count: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
const mockPostTagMethods = { deleteMany: vi.fn() };
const mockPrismaInstance = {
  post: mockPostMethods,
  postTag: mockPostTagMethods,
  $disconnect: vi.fn(),
  $extends: vi.fn(),
};
vi.mock("@prisma/client/edge", () => ({
  PrismaClient: vi.fn(() => mockPrismaInstance),
}));
vi.mock("@prisma/extension-accelerate", () => ({
  withAccelerate: vi.fn(() => (client: any) => client),
}));

const mockLpush = vi.fn();
const mockRedisClient = { lpush: mockLpush };
vi.mock("@upstash/redis/cloudflare", () => ({
  Redis: { fromEnv: vi.fn(() => mockRedisClient) },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockEnv: HonoEnv["Bindings"] = {
  DATABASE_URL: "mock_db_url_for_posts",
  JWT_SECRET: "mock_jwt_secret_for_posts",
  UPSTASH_REDIS_REST_URL: "mock_upstash_redis_url",
  UPSTASH_REDIS_REST_TOKEN: "mock_upstash_redis_token",
  RAILWAY_CONSUMER_WAKEUP_URL: "http://mock-wakeup-url.com/wakeup",
  RAILWAY_WAKEUP_SECRET: "mock-wakeup-secret",
  UPSTASH_RATELIMIT_REDIS_REST_URL: "mock_ratelimit_url",
  UPSTASH_RATELIMIT_REDIS_REST_TOKEN: "mock_ratelimit_token",
};

const mockWaitUntil = vi.fn();
const mockExecutionContext = {
  waitUntil: mockWaitUntil,
  passThroughOnException: vi.fn(),
};

const app = new Hono<{
  Bindings: HonoEnv["Bindings"];
  Variables: HonoEnv["Variables"];
}>();
app.route("/", postRouter);

interface ZodErrorDetail {
  message: string;
  path: (string | number)[]
}
interface ErrorResponse {
  error: string | ZodErrorDetail[];
}
interface SuccessMessageResponse {
  message: string;
}

interface AuthorForPost {
  id: number;
  username: string;
  email: string;
}
interface TagForPost {
  tag: Tag;
}
interface PostDetails
  extends Omit<Post, "authorId" | "createdAt" | "updatedAt"> {
  createdAt: string;
  updatedAt: string;
  author: AuthorForPost;
  tags: TagForPost[];
}
interface PaginatedPostsResponse {
  data: PostDetails[];
  totalPages: number;
  currentPage: number;
  totalPosts: number;
}

describe("Post Router (post.ts)", () => {
  const testDate = new Date();
  const testDateISO = testDate.toISOString();
  const testUserId = 1;

  const commonAuthor: AuthorForPost = {
    id: testUserId,
    username: "TestUser",
    email: "test@example.com",
  };
  const sampleTag: Tag = { id: 1, name: "Tech" };
  const sampleTagForPost: TagForPost = { tag: sampleTag };
  const mockPost: PostDetails = {
    id: 1,
    title: "Test Post 1",
    body: "Body of test post 1",
    imageUrl: null,
    author: commonAuthor,
    tags: [sampleTagForPost],
    summary: "Pending summary",
    summaryStatus: "PENDING",
    createdAt: testDateISO,
    updatedAt: testDateISO,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaInstance.$extends
      .mockReset()
      .mockImplementation(() => mockPrismaInstance);
    mockPrismaInstance.$disconnect.mockReset().mockResolvedValue(undefined);
    Object.values(mockPostMethods).forEach((mockFn) => mockFn.mockReset());
    mockPostTagMethods.deleteMany.mockReset();
    mockLpush.mockReset();
    mockFetch
      .mockReset()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "wakeup ack" }), { status: 200 })
      );
    mockWaitUntil.mockReset();
    mockAuthMiddlewareFn.mockImplementation(async (c, next) => {
      c.set("user", { id: testUserId });
      await next();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET / (List Posts)", () => {
    it("should fetch posts with default pagination", async () => {
      mockPostMethods.findMany.mockResolvedValue([mockPost]);
      mockPostMethods.count.mockResolvedValue(1);
      const request = new Request("http://localhost/", { method: "GET" });
      const response = await app.fetch(request, mockEnv, mockExecutionContext);
      const body = (await response.json()) as PaginatedPostsResponse;
      expect(response.status).toBe(StatusCode.OK);
      expect(mockPostMethods.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 6 })
      );
      expect(body.data[0].title).toBe(mockPost.title);
    });

    it("should handle custom pagination", async () => {
      mockPostMethods.findMany.mockResolvedValue([]);
      mockPostMethods.count.mockResolvedValue(10);
      const page = 2;
      const limit = 3;
      const request = new Request(
        `http://localhost/?page=${page}&limit=${limit}`,
        { method: "GET" }
      );
      await app.fetch(request, mockEnv, mockExecutionContext);
      expect(mockPostMethods.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: (page - 1) * limit, take: limit })
      );
    });

    it("should return 500 if Prisma findMany fails", async () => {
      mockPostMethods.findMany.mockRejectedValue(
        new Error("DB findMany error")
      );
      const request = new Request("http://localhost/", { method: "GET" });
      const response = await app.fetch(request, mockEnv, mockExecutionContext);
      const body = (await response.json()) as ErrorResponse; 
      expect(response.status).toBe(StatusCode.INTERNAL_SERVER_ERROR);
      expect(body.error).toBe("Failed to get posts");
    });
  });

  describe("GET /:id (Get Single Post)", () => {
    it("should fetch a single post by ID", async () => {
      mockPostMethods.findUnique.mockResolvedValue(mockPost);
      const request = new Request(`http://localhost/${mockPost.id}`, {
        method: "GET",
      });
      const response = await app.fetch(request, mockEnv, mockExecutionContext);
      const body = (await response.json()) as PostDetails;
      expect(response.status).toBe(StatusCode.OK);
      expect(mockPostMethods.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: mockPost.id } })
      );
      expect(body.title).toBe(mockPost.title);
    });

    it("should return 400 for invalid post ID format", async () => {
      const request = new Request("http://localhost/abc", { method: "GET" });
      const response = await app.fetch(request, mockEnv, mockExecutionContext);
      const body = (await response.json()) as ErrorResponse;
      expect(response.status).toBe(StatusCode.BAD_REQUEST);
      expect(body.error).toBeInstanceOf(Array);
    });

    it("should return 404 if post not found", async () => {
      mockPostMethods.findUnique.mockResolvedValue(null);
      const request = new Request("http://localhost/999", { method: "GET" });
      const response = await app.fetch(request, mockEnv, mockExecutionContext);
      const body = (await response.json()) as ErrorResponse;
      expect(response.status).toBe(StatusCode.NOT_FOUND);
      expect(body.error).toBe("Post not found");
    });
  });

  describe("POST / (Create Post)", () => {
    const createData = {
      title: "New Post",
      body: "New Body",
      tags: ["NewTag1", "Another Tag"],
    };

    it("should create a new post, enqueue job, and trigger wakeup", async () => {
      mockPostMethods.create.mockResolvedValue(mockPost);
      mockLpush.mockResolvedValue(1);
      const request = new Request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createData),
      });
      const response = await app.fetch(request, mockEnv, mockExecutionContext);
      const body = (await response.json()) as PostDetails;
      expect(response.status).toBe(StatusCode.CREATED);
      expect(mockPostMethods.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: createData.title }),
        })
      );
      expect(mockLpush).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalled();
      expect(mockWaitUntil).toHaveBeenCalled();
      expect(body.title).toBe(mockPost.title);
    });

    it("should return 400 for invalid post data", async () => {
      const request = new Request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "" }),
      });
      const response = await app.fetch(request, mockEnv, mockExecutionContext);
      const body = (await response.json()) as ErrorResponse;
      expect(response.status).toBe(StatusCode.BAD_REQUEST);
      expect(body.error).toBeInstanceOf(Array);
    });

    it("should handle Redis lpush failure gracefully", async () => {
      mockPostMethods.create.mockResolvedValue(mockPost);
      mockLpush.mockRejectedValue(new Error("Redis down"));
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const request = new Request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createData),
      });
      const response = await app.fetch(request, mockEnv, mockExecutionContext);
      expect(response.status).toBe(StatusCode.CREATED);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to enqueue job"),
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe("PUT /:id (Update Post)", () => {
    const postIdToUpdate = mockPost.id;
    const updateData = { title: "Updated Title", tags: ["UpdatedTag"] };

    it("should update a post, re-enqueue job, and trigger wakeup", async () => {
      mockPostMethods.findUnique.mockResolvedValueOnce({
        authorId: testUserId,
      });
      mockPostTagMethods.deleteMany.mockResolvedValue({ count: 1 });
      mockPostMethods.update.mockResolvedValue({
        ...mockPost,
        ...updateData,
        summaryStatus: "PENDING",
      });
      mockPostMethods.findUnique.mockResolvedValueOnce({
        ...mockPost,
        ...updateData,
        summaryStatus: "PENDING",
        tags: [{ tag: { id: 2, name: "UpdatedTag" } }],
      });
      const request = new Request(`http://localhost/${postIdToUpdate}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });
      const response = await app.fetch(request, mockEnv, mockExecutionContext);
      const body = (await response.json()) as PostDetails;
      expect(response.status).toBe(StatusCode.OK);
      expect(mockPostTagMethods.deleteMany).toHaveBeenCalled();
      expect(mockPostMethods.update).toHaveBeenCalled();
      expect(mockLpush).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalled();
      expect(mockWaitUntil).toHaveBeenCalled();
      expect(body.title).toBe(updateData.title);
    });

    it("should return 404 if post to update not found", async () => {
      mockPostMethods.findUnique.mockResolvedValue(null);
      const request = new Request(`http://localhost/999`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });
      const response = await app.fetch(request, mockEnv, mockExecutionContext);
      const body = (await response.json()) as ErrorResponse;
      expect(response.status).toBe(StatusCode.NOT_FOUND);
      expect(body.error).toBe("Post not found");
    });

    it("should return 401 if user is not the author", async () => {
      mockPostMethods.findUnique.mockResolvedValue({
        authorId: testUserId + 1,
      });
      const request = new Request(`http://localhost/${postIdToUpdate}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });
      const response = await app.fetch(request, mockEnv, mockExecutionContext);
      const body = (await response.json()) as ErrorResponse;
      expect(response.status).toBe(StatusCode.UNAUTHORIZED);
      expect(body.error).toBe("Unauthorized");
    });

    it("should return 400 for no fields to update", async () => {
      mockPostMethods.findUnique.mockResolvedValueOnce({
        authorId: testUserId,
      });
      const request = new Request(`http://localhost/${postIdToUpdate}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const response = await app.fetch(request, mockEnv, mockExecutionContext);
      const body = (await response.json()) as SuccessMessageResponse;
      expect(response.status).toBe(StatusCode.BAD_REQUEST);
      expect(body.message).toBe("No fields to update");
    });
  });

  describe("DELETE /:id (Delete Post)", () => {
    const postIdToDelete = mockPost.id;

    it("should delete a post if user is the author", async () => {
      mockPostMethods.findUnique.mockResolvedValue({
        ...mockPost,
        authorId: testUserId,
      });
      mockPostTagMethods.deleteMany.mockResolvedValue({ count: 1 });
      mockPostMethods.delete.mockResolvedValue(mockPost);
      const request = new Request(`http://localhost/${postIdToDelete}`, {
        method: "DELETE",
      });
      const response = await app.fetch(request, mockEnv, mockExecutionContext);
      const body = (await response.json()) as SuccessMessageResponse;
      expect(response.status).toBe(StatusCode.OK);
      expect(mockPostTagMethods.deleteMany).toHaveBeenCalled();
      expect(mockPostMethods.delete).toHaveBeenCalled();
      expect(body.message).toBe("Post deleted successfully");
    });

    it("should return 404 if post to delete not found", async () => {
      mockPostMethods.findUnique.mockResolvedValue(null);
      const request = new Request(`http://localhost/999`, { method: "DELETE" });
      const response = await app.fetch(request, mockEnv, mockExecutionContext);
      const body = (await response.json()) as ErrorResponse;
      expect(response.status).toBe(StatusCode.NOT_FOUND);
      expect(body.error).toBe("Post not found");
    });

    it("should return 401 if user is not the author for delete", async () => {
      mockPostMethods.findUnique.mockResolvedValue({
        ...mockPost,
        authorId: testUserId + 1,
      });
      const request = new Request(`http://localhost/${postIdToDelete}`, {
        method: "DELETE",
      });
      const response = await app.fetch(request, mockEnv, mockExecutionContext);
      const body = (await response.json()) as ErrorResponse;
      expect(response.status).toBe(StatusCode.UNAUTHORIZED);
      expect(body.error).toBe("Unauthorized");
    });
  });
});
