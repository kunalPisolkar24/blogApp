import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { userRouter, type UserHonoEnv } from "../user";
import { StatusCode } from "../../constants/status-code";

function calculateHexFromInput(inputString: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(inputString);
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const MOCK_DIGEST_INPUT_STRING = "MOCK_HASH_INPUT";
const MOCK_PASSWORD_HASH = calculateHexFromInput(MOCK_DIGEST_INPUT_STRING);

const { mockSign, mockVerify, mockAuthMiddlewareFn } = vi.hoisted(() => {
  return {
    mockSign: vi.fn(),
    mockVerify: vi.fn(),
    mockAuthMiddlewareFn: vi.fn(async (c, next) => {
      c.set("user", { id: 1 });
      await next();
    }),
  };
});

vi.mock("hono/jwt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("hono/jwt")>();
  return { ...actual, sign: mockSign, verify: mockVerify };
});

vi.mock("../../middleware/auth", () => ({
  authMiddleware: mockAuthMiddlewareFn,
}));

const mockUserMethods = {
  create: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
};
const mockPrismaInstance = {
  user: mockUserMethods,
  $disconnect: vi.fn(),
  $extends: vi.fn(),
};
vi.mock("@prisma/client/edge", () => ({
  PrismaClient: vi.fn(() => mockPrismaInstance),
}));
vi.mock("@prisma/extension-accelerate", () => ({
  withAccelerate: vi.fn(() => (client: any) => client),
}));

const mockDigest = vi.fn(); 

if (typeof crypto === "undefined" || !crypto.subtle) {
  console.warn(
    "Web Crypto API (crypto.subtle) not fully available during test setup. Digest mocking might be incomplete."
  );
}

const mockEnv: UserHonoEnv["Bindings"] = {
  DATABASE_URL: "mock_db_url",
  JWT_SECRET: "mock_jwt_secret_for_testing",
  DATABASE_URL_MIGRATE: "mock_migrate_url",
  UPSTASH_REDIS_REST_URL: "mock_upstash_url",
  UPSTASH_REDIS_REST_TOKEN: "mock_upstash_token",
  RAILWAY_CONSUMER_WAKEUP_URL: "mock_railway_url",
  RAILWAY_WAKEUP_SECRET: "mock_railway_secret",
  UPSTASH_RATELIMIT_REDIS_REST_URL: "mock_ratelimit_url",
  UPSTASH_RATELIMIT_REDIS_REST_TOKEN: "mock_ratelimit_token",
};

const app = new Hono<{ Bindings: UserHonoEnv["Bindings"] }>();
app.route("/", userRouter);

interface ErrorResponse {
  error: string | { message: string; path: (string | number)[] }[] | any[];
}
interface ZodErrorDetail {
  code: string;
  expected?: any;
  received?: any;
  path: (string | number)[];
  message: string;
}
interface ZodErrorResponse {
  error: ZodErrorDetail[];
}
interface SignUpSuccessResponse {
  newUser: { id: number; email: string; username: string; password?: string };
  jwt: string;
}
interface SignInSuccessResponse {
  user: { id: number; email: string; username: string; password: string };
  jwt: string;
}
interface UserDetailsResponse {
  email: string;
  username: string;
}
interface UserListResponseItem {
  id: number;
  email: string;
  username: string;
}

describe("User Router (user.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrismaInstance.$extends
      .mockReset()
      .mockImplementation(() => mockPrismaInstance);
    mockPrismaInstance.$disconnect.mockReset().mockResolvedValue(undefined);
    mockUserMethods.create.mockReset();
    mockUserMethods.findUnique.mockReset();
    mockUserMethods.findMany.mockReset();

    mockSign.mockResolvedValue("mock.jwt.token");
    mockVerify.mockResolvedValue({ id: 1 });

    const mockDigestOutputBuffer = new TextEncoder().encode(
      MOCK_DIGEST_INPUT_STRING
    ).buffer;
    if (crypto?.subtle?.digest) {
      if (!vi.isMockFunction(crypto.subtle.digest)) {
        vi.spyOn(crypto.subtle, "digest").mockResolvedValue(
          mockDigestOutputBuffer
        );
      } else {
        // @ts-ignore
        (crypto.subtle.digest as vi.Mock)
          .mockReset()
          .mockResolvedValue(mockDigestOutputBuffer);
      }
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /signup", () => {
    it("should create a new user and return user data and JWT on valid input", async () => {
      const signupData = {
        email: "test@example.com",
        password: "password123",
        username: "testuser",
      };
      const expectedUserInResponse = {
        id: 1,
        email: signupData.email,
        username: signupData.username,
        password: MOCK_PASSWORD_HASH,
      };
      mockUserMethods.create.mockResolvedValue(expectedUserInResponse);

      const request = new Request("http://localhost/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signupData),
      });
      const response = await app.fetch(request, mockEnv);
      const body = (await response.json()) as SignUpSuccessResponse;

      expect(response.status).toBe(StatusCode.CREATED);
      expect(mockUserMethods.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: signupData.email,
            username: signupData.username,
            password: MOCK_PASSWORD_HASH,
          }),
        })
      );
      expect(mockSign).toHaveBeenCalledWith(
        { id: expectedUserInResponse.id },
        mockEnv.JWT_SECRET
      );
      expect(body.newUser).toEqual(expectedUserInResponse);
      expect(body.jwt).toBe("mock.jwt.token");
    });

    it("should return 400 on invalid signup data (Zod error)", async () => {
      const signupData = { email: "not-an-email", password: "short" };
      const request = new Request("http://localhost/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signupData),
      });
      const response = await app.fetch(request, mockEnv);
      expect(response.status).toBe(StatusCode.BAD_REQUEST);
      const body = (await response.json()) as ZodErrorResponse;
      expect(body.error).toBeInstanceOf(Array);
      expect(body.error.length).toBeGreaterThan(0);
    });

    it("should return 500 if Prisma user creation fails", async () => {
      mockUserMethods.create.mockRejectedValue(
        new Error("Prisma create failed")
      );
      const signupData = {
        email: "testfail@example.com",
        password: "password123",
        username: "testfailuser",
      };
      const request = new Request("http://localhost/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signupData),
      });
      const response = await app.fetch(request, mockEnv);
      expect(response.status).toBe(StatusCode.INTERNAL_SERVER_ERROR);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error).toBe("Failed to create user");
    });
  });

  describe("POST /signin", () => {
    const signinData = { email: "test@example.com", password: "password123" };
    const mockDbUser = {
      id: 1,
      email: signinData.email,
      username: "testuser",
      password: MOCK_PASSWORD_HASH,
    };
    const expectedUserInSigninResponse = {
      id: 1,
      email: signinData.email,
      username: "testuser",
      password: MOCK_PASSWORD_HASH,
    };

    it("should sign in an existing user and return user data and JWT", async () => {
      mockUserMethods.findUnique.mockResolvedValue(mockDbUser);
      const request = new Request("http://localhost/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signinData),
      });
      const response = await app.fetch(request, mockEnv);

      expect(response.status).toBe(StatusCode.OK);
      const body = (await response.json()) as SignInSuccessResponse;
      expect(mockUserMethods.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: signinData.email } })
      );
      expect(mockSign).toHaveBeenCalledWith(
        { id: mockDbUser.id },
        mockEnv.JWT_SECRET
      );
      expect(body.user).toEqual(expectedUserInSigninResponse);
      expect(body.jwt).toBe("mock.jwt.token");
    });

    it("should return 401 if user not found", async () => {
      mockUserMethods.findUnique.mockResolvedValue(null);
      const request = new Request("http://localhost/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signinData),
      });
      const response = await app.fetch(request, mockEnv);
      expect(response.status).toBe(StatusCode.UNAUTHORIZED);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error).toBe("Invalid email or password");
    });

    it("should return 401 if password does not match", async () => {
      mockUserMethods.findUnique.mockResolvedValue({
        ...mockDbUser,
        password: "definitely-not-MOCK_PASSWORD_HASH",
      });
      const request = new Request("http://localhost/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signinData),
      });
      const response = await app.fetch(request, mockEnv);
      expect(response.status).toBe(StatusCode.UNAUTHORIZED);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error).toBe("Invalid email or password");
    });

    it("should return 400 on invalid signin data (Zod error)", async () => {
      const invalidSigninData = { email: "not-an-email" };
      const request = new Request("http://localhost/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invalidSigninData),
      });
      const response = await app.fetch(request, mockEnv);
      expect(response.status).toBe(StatusCode.BAD_REQUEST);
      const body = (await response.json()) as ZodErrorResponse;
      expect(body.error).toBeInstanceOf(Array);
    });
  });

  describe("GET /users/:id", () => {
    it("should return user details if user found and ID is valid", async () => {
      const userId = 1;
      const mockUserFromDb = {
        email: "test@example.com",
        username: "testuser",
      };
      mockUserMethods.findUnique.mockResolvedValue(mockUserFromDb);
      const request = new Request(`http://localhost/users/${userId}`, {
        method: "GET",
      });
      const response = await app.fetch(request, mockEnv);

      expect(response.status).toBe(StatusCode.OK);
      const body = (await response.json()) as UserDetailsResponse;
      expect(mockAuthMiddlewareFn).toHaveBeenCalled();
      expect(mockUserMethods.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: userId },
          select: { email: true, username: true },
        })
      );
      expect(body).toEqual(mockUserFromDb);
    });

    it("should return 404 if user not found", async () => {
      const userId = 99;
      mockUserMethods.findUnique.mockResolvedValue(null);
      const request = new Request(`http://localhost/users/${userId}`, {
        method: "GET",
      });
      const response = await app.fetch(request, mockEnv);
      expect(response.status).toBe(StatusCode.NOT_FOUND);
      const body = (await response.json()) as ErrorResponse;
      expect(mockAuthMiddlewareFn).toHaveBeenCalled();
      expect(body.error).toBe("User not found");
    });

    it("should return 400 if ID is not a valid number format for Zod schema", async () => {
      const invalidUserId = "abc";
      const request = new Request(`http://localhost/users/${invalidUserId}`, {
        method: "GET",
      });
      const response = await app.fetch(request, mockEnv);
      expect(response.status).toBe(StatusCode.BAD_REQUEST);
      const body = (await response.json()) as ZodErrorResponse;
      expect(mockAuthMiddlewareFn).toHaveBeenCalled();
      expect(body.error).toBeInstanceOf(Array);
    });
  });

  describe("GET /users", () => {
    it("should return a list of users", async () => {
      const mockUsersList: UserListResponseItem[] = [
        { id: 1, email: "user1@example.com", username: "user1" },
        { id: 2, email: "user2@example.com", username: "user2" },
      ];
      mockUserMethods.findMany.mockResolvedValue(mockUsersList);
      const request = new Request("http://localhost/users", { method: "GET" });
      const response = await app.fetch(request, mockEnv);
      expect(response.status).toBe(StatusCode.OK);
      const body = (await response.json()) as UserListResponseItem[];
      expect(mockAuthMiddlewareFn).toHaveBeenCalled();
      expect(mockUserMethods.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { id: true, email: true, username: true },
        })
      );
      expect(body).toEqual(mockUsersList);
    });

    it("should return 500 if Prisma findMany fails", async () => {
      mockUserMethods.findMany.mockRejectedValue(
        new Error("Prisma findMany failed")
      );
      const request = new Request("http://localhost/users", { method: "GET" });
      const response = await app.fetch(request, mockEnv);
      expect(response.status).toBe(StatusCode.INTERNAL_SERVER_ERROR);
      const body = (await response.json()) as ErrorResponse;
      expect(mockAuthMiddlewareFn).toHaveBeenCalled();
      expect(body.error).toBe("Failed to get users");
    });
  });
});
