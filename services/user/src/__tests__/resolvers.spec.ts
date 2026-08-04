import { describe, it, expect, vi } from 'vitest';
import { resolvers } from '../graphql/resolvers.js';
import { UnauthorizedError, UserNotFoundError, ValidationError } from '../errors.js';
import type { GraphQLContext } from '../context.js';

type UserServiceLike = GraphQLContext['userService'];

const makeContext = (overrides: Partial<GraphQLContext> = {}): GraphQLContext => ({
  user: null,
  userService: {
    findById: vi.fn(),
    findAll: vi.fn(),
    signup: vi.fn(),
    signin: vi.fn(),
    updateProfile: vi.fn(),
  } as unknown as UserServiceLike,
  ...overrides,
});

describe('Query.me', () => {
  it('returns null when unauthenticated', () => {
    const ctx = makeContext();

    expect(resolvers.Query.me(null, {}, ctx)).toBeNull();
    expect(ctx.userService.findById).not.toHaveBeenCalled();
  });

  it('returns the current user when authenticated', async () => {
    const ctx = makeContext({ user: { id: 'u1' } });
    vi.mocked(ctx.userService.findById).mockResolvedValue({ id: 'u1' } as never);

    await expect(resolvers.Query.me(null, {}, ctx)).resolves.toEqual({ id: 'u1' });
    expect(ctx.userService.findById).toHaveBeenCalledWith('u1');
  });
});

describe('Query.user', () => {
  it('returns the user when found', async () => {
    const ctx = makeContext();
    vi.mocked(ctx.userService.findById).mockResolvedValue({ id: 'u1' } as never);

    await expect(resolvers.Query.user(null, { id: 'u1' }, ctx)).resolves.toEqual({ id: 'u1' });
  });

  it('throws UserNotFoundError when the user does not exist', async () => {
    const ctx = makeContext();
    vi.mocked(ctx.userService.findById).mockResolvedValue(null);

    await expect(resolvers.Query.user(null, { id: 'u1' }, ctx)).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
  });
});

describe('Query.users', () => {
  it('uses the default limit of 20', async () => {
    const ctx = makeContext();
    vi.mocked(ctx.userService.findAll).mockResolvedValue([]);

    await resolvers.Query.users(null, {}, ctx);

    expect(ctx.userService.findAll).toHaveBeenCalledWith({ limit: 20, cursor: undefined });
  });

  it('clamps the limit to the allowed range', async () => {
    const ctx = makeContext();
    vi.mocked(ctx.userService.findAll).mockResolvedValue([]);

    await resolvers.Query.users(null, { limit: 999 }, ctx);
    await resolvers.Query.users(null, { limit: 0 }, ctx);

    expect(ctx.userService.findAll).toHaveBeenNthCalledWith(1, { limit: 50, cursor: undefined });
    expect(ctx.userService.findAll).toHaveBeenNthCalledWith(2, { limit: 1, cursor: undefined });
  });

  it('floors fractional limits and forwards the cursor', async () => {
    const ctx = makeContext();
    vi.mocked(ctx.userService.findAll).mockResolvedValue([]);

    await resolvers.Query.users(null, { limit: 10.7, cursor: 'u5' }, ctx);

    expect(ctx.userService.findAll).toHaveBeenCalledWith({ limit: 10, cursor: 'u5' });
  });
});

describe('Mutation.signup', () => {
  it('validates and delegates to the service', async () => {
    const ctx = makeContext();
    const args = { email: 'alice@example.com', username: 'alice', password: 'password-1234' };
    vi.mocked(ctx.userService.signup).mockResolvedValue({ token: 't', user: null } as never);

    await resolvers.Mutation.signup(null, args, ctx);

    expect(ctx.userService.signup).toHaveBeenCalledWith(args);
  });

  it('rejects invalid input', () => {
    const ctx = makeContext();

    expect(() => resolvers.Mutation.signup(null, { email: 'nope' }, ctx)).toThrow(
      ValidationError,
    );
    expect(ctx.userService.signup).not.toHaveBeenCalled();
  });
});

describe('Mutation.signin', () => {
  it('validates and delegates to the service', async () => {
    const ctx = makeContext();
    const args = { email: 'alice@example.com', password: 'password-1234' };
    vi.mocked(ctx.userService.signin).mockResolvedValue({ token: 't', user: null } as never);

    await resolvers.Mutation.signin(null, args, ctx);

    expect(ctx.userService.signin).toHaveBeenCalledWith(args);
  });
});

describe('Mutation.updateProfile', () => {
  it('throws UnauthorizedError when unauthenticated', () => {
    const ctx = makeContext();

    expect(() => resolvers.Mutation.updateProfile(null, { name: 'Alice' }, ctx)).toThrow(
      UnauthorizedError,
    );
    expect(ctx.userService.updateProfile).not.toHaveBeenCalled();
  });

  it('validates and delegates to the service for the current user', async () => {
    const ctx = makeContext({ user: { id: 'u1' } });
    const args = { name: 'Alice Updated' };
    vi.mocked(ctx.userService.updateProfile).mockResolvedValue({ id: 'u1' } as never);

    await resolvers.Mutation.updateProfile(null, args, ctx);

    expect(ctx.userService.updateProfile).toHaveBeenCalledWith('u1', args);
  });
});

describe('User.__resolveReference', () => {
  it('resolves a federated reference by id', async () => {
    const ctx = makeContext();
    vi.mocked(ctx.userService.findById).mockResolvedValue({ id: 'u1' } as never);

    await expect(resolvers.User.__resolveReference({ id: 'u1' }, ctx)).resolves.toEqual({
      id: 'u1',
    });
    expect(ctx.userService.findById).toHaveBeenCalledWith('u1');
  });
});