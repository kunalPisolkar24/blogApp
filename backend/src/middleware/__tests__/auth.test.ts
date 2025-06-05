import { describe, it, expect, vi, beforeEach } from "vitest";
import { authMiddleware } from "../auth";
import { StatusCode } from "../../constants/status-code";
import type { Next } from "hono";

const { mockVerifyFn } = vi.hoisted(() => {
  return {
    mockVerifyFn: vi.fn(),
  };
});

vi.mock("hono/jwt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("hono/jwt")>();
  return {
    ...actual,
    verify: mockVerifyFn,
  };
});

describe("Auth Middleware (auth.ts)", () => {
  let mockContext: any;
  let mockNext: Next;
  const mockJwtSecret = "test-secret";
  const mockUserPayload = { id: 123, username: "testuser" };

  beforeEach(() => {
    vi.clearAllMocks();

    mockNext = vi.fn();
    mockContext = {
      req: {
        header: vi.fn(),
      },
      env: {
        JWT_SECRET: mockJwtSecret,
      },
      json: vi.fn((data, status) => ({
        status,
        json: () => Promise.resolve(data),
      })),
      set: vi.fn(),
    };
  });

  it("should call next() and set user on valid token", async () => {
    mockContext.req.header.mockReturnValue("Bearer valid-token");
    mockVerifyFn.mockResolvedValue(mockUserPayload);

    await authMiddleware(mockContext, mockNext);

    expect(mockContext.req.header).toHaveBeenCalledWith("Authorization");
    expect(mockVerifyFn).toHaveBeenCalledWith("valid-token", mockJwtSecret);
    expect(mockContext.set).toHaveBeenCalledWith("user", mockUserPayload);
    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockContext.json).not.toHaveBeenCalled();
  });

  it("should return 401 if Authorization header is missing", async () => {
    mockContext.req.header.mockReturnValue(undefined);

    const response = await authMiddleware(mockContext, mockNext);

    expect(mockVerifyFn).not.toHaveBeenCalled();
    expect(mockContext.set).not.toHaveBeenCalled();
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockContext.json).toHaveBeenCalledWith(
      { error: "Unauthorized" },
      StatusCode.UNAUTHORIZED
    );
    expect(response?.status).toBe(StatusCode.UNAUTHORIZED);
    const body = await response?.json();
    expect(body?.error).toBe("Unauthorized");
  });

  it("should return 401 if token is missing from Authorization header", async () => {
    mockContext.req.header.mockReturnValue("Bearer ");

    const response = await authMiddleware(mockContext, mockNext);

    expect(mockVerifyFn).not.toHaveBeenCalled(); 
    expect(mockContext.set).not.toHaveBeenCalled();
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockContext.json).toHaveBeenCalledWith(
      { error: "Unauthorized" },
      StatusCode.UNAUTHORIZED
    );
  });

  it("should return 401 if Authorization header is malformed (no Bearer prefix, so token is undefined after split)", async () => {
    mockContext.req.header.mockReturnValue("some-token-without-bearer");

    const response = await authMiddleware(mockContext, mockNext);

    expect(mockVerifyFn).not.toHaveBeenCalled();
    expect(mockContext.set).not.toHaveBeenCalled();
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockContext.json).toHaveBeenCalledWith(
      { error: "Unauthorized" },
      StatusCode.UNAUTHORIZED
    );
    expect(response?.status).toBe(StatusCode.UNAUTHORIZED);
    const body = await response?.json();
    expect(body?.error).toBe("Unauthorized");
  });

  it("should return 401 if jwt verify fails (e.g., invalid token)", async () => {
    mockContext.req.header.mockReturnValue("Bearer invalid-token");
    mockVerifyFn.mockRejectedValue(new Error("Token verification failed"));

    const response = await authMiddleware(mockContext, mockNext);

    expect(mockVerifyFn).toHaveBeenCalledWith("invalid-token", mockJwtSecret);
    expect(mockContext.set).not.toHaveBeenCalled();
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockContext.json).toHaveBeenCalledWith(
      { error: "Unauthorized" },
      StatusCode.UNAUTHORIZED
    );
  });

  it("should call set and next if jwt verify resolves with a non-error falsy value (e.g. null)", async () => {
    mockContext.req.header.mockReturnValue("Bearer valid-token-empty-payload");
    mockVerifyFn.mockResolvedValue(null);

    await authMiddleware(mockContext, mockNext);

    expect(mockVerifyFn).toHaveBeenCalledWith(
      "valid-token-empty-payload",
      mockJwtSecret
    );
    expect(mockContext.set).toHaveBeenCalledWith("user", null);
    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockContext.json).not.toHaveBeenCalled();
  });
});
