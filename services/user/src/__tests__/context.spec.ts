import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createContext } from '../context.js';
import type { UserService } from '../user.service.js';

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
}));

vi.mock('../utils/token.js', () => ({ verifyToken: mocks.verifyToken }));

const makeHonoContext = (header: string | undefined) =>
  ({
    req: { header: vi.fn().mockReturnValue(header) },
  }) as unknown as Parameters<typeof createContext>[0];

const userService = {} as UserService;

describe('createContext', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns a null user when the authorization header is missing', async () => {
    const ctx = await createContext(makeHonoContext(undefined), userService);

    expect(ctx.user).toBeNull();
    expect(ctx.userService).toBe(userService);
    expect(mocks.verifyToken).not.toHaveBeenCalled();
  });

  it('extracts a bearer token and resolves the user', async () => {
    mocks.verifyToken.mockResolvedValue({ id: 'u1' });

    const ctx = await createContext(makeHonoContext('Bearer eyJhbGciOi'), userService);

    expect(ctx.user).toEqual({ id: 'u1' });
    expect(mocks.verifyToken).toHaveBeenCalledWith('eyJhbGciOi');
  });

  it('accepts a case-insensitive bearer prefix', async () => {
    mocks.verifyToken.mockResolvedValue({ id: 'u1' });

    const ctx = await createContext(makeHonoContext('bearer abc.def'), userService);

    expect(ctx.user).toEqual({ id: 'u1' });
    expect(mocks.verifyToken).toHaveBeenCalledWith('abc.def');
  });

  it('treats a missing or malformed token as unauthenticated', async () => {
    const ctx = await createContext(makeHonoContext('Basic dXNlcjpwYXNz'), userService);

    expect(ctx.user).toBeNull();
    expect(mocks.verifyToken).not.toHaveBeenCalled();
  });

  it('treats an invalid token as unauthenticated', async () => {
    mocks.verifyToken.mockResolvedValue(null);

    const ctx = await createContext(makeHonoContext('Bearer invalid'), userService);

    expect(ctx.user).toBeNull();
  });
});