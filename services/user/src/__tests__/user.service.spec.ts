import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserService, toUserResponse } from '../user.service.js';
import { Prisma, type PrismaClient, type User } from '../generated/prisma/client.js';
import {
  InvalidCredentialsError,
  UserAlreadyExistsError,
  UserNotFoundError,
} from '../errors.js';

const mocks = vi.hoisted(() => ({
  env: { REDIS_CACHE_TTL_MS: 3600000 },
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    keys: vi.fn(),
  },
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  signToken: vi.fn(),
  primaryDb: vi.fn(),
}));

vi.mock('../config/env.js', () => ({ env: mocks.env }));
vi.mock('../lib/redis.js', () => ({ redis: mocks.redis }));
vi.mock('../lib/prisma.js', () => ({ primaryDb: mocks.primaryDb }));
vi.mock('../utils/password.js', () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
}));
vi.mock('../utils/token.js', () => ({ signToken: mocks.signToken }));

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'u1',
  username: 'alice',
  email: 'alice@example.com',
  password: 'scrypt:hash',
  name: 'Alice',
  bio: null,
  avatarUrl: null,
  bannerUrl: null,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  ...overrides,
});

const prismaError = (code: string): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Prisma client error', {
    code,
    clientVersion: '7.9.1',
  });

const createUserMocks = () => ({
  user: {
    findUnique: vi.fn<(args: Prisma.UserFindUniqueArgs) => Promise<User | null>>(),
    findMany: vi.fn<(args: Prisma.UserFindManyArgs) => Promise<User[]>>(),
    create: vi.fn<(args: Prisma.UserCreateArgs) => Promise<User>>(),
    update: vi.fn<(args: Prisma.UserUpdateArgs) => Promise<User>>(),
  },
});

type PrismaUserMocks = ReturnType<typeof createUserMocks>;

describe('UserService', () => {
  let service: UserService;
  let prisma: PrismaUserMocks;
  let primary: PrismaUserMocks;

  beforeEach(() => {
    vi.resetAllMocks();
    prisma = createUserMocks();
    primary = createUserMocks();
    service = new UserService(
      prisma as unknown as PrismaClient,
      primary as unknown as PrismaClient,
    );
  });

  describe('toUserResponse', () => {
    it('maps the user model to the public response shape', () => {
      expect(toUserResponse(makeUser())).toEqual({
        id: 'u1',
        username: 'alice',
        email: 'alice@example.com',
        name: 'Alice',
        bio: null,
        avatarUrl: null,
        bannerUrl: null,
        createdAt: '2024-01-01T00:00:00.000Z',
      });
    });

    it('never exposes the password hash', () => {
      expect(toUserResponse(makeUser())).not.toHaveProperty('password');
    });
  });

  describe('signup', () => {
    const input = {
      email: 'alice@example.com',
      username: 'alice',
      password: 'str0ng-password-1234',
    };

    beforeEach(() => {
      mocks.hashPassword.mockResolvedValue('hashed-password');
      mocks.signToken.mockResolvedValue('token');
      prisma.user.create.mockResolvedValue(makeUser());
    });

    it('hashes the password before storing the user', async () => {
      await service.signup(input);

      expect(mocks.hashPassword).toHaveBeenCalledWith(input.password);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: input.email,
          username: input.username,
          password: 'hashed-password',
          name: input.username,
        },
      });
    });

    it('returns a token and the new user', async () => {
      await expect(service.signup(input)).resolves.toEqual({
        token: 'token',
        user: toUserResponse(makeUser()),
      });
    });

    it('invalidates the user list caches', async () => {
      mocks.redis.keys.mockResolvedValue(['users:10:']);
      mocks.redis.del.mockResolvedValue(1);

      await service.signup(input);

      expect(mocks.redis.keys).toHaveBeenCalledWith('users:*');
      expect(mocks.redis.del).toHaveBeenCalledWith('users:10:');
    });

    it('maps a unique-constraint violation to UserAlreadyExistsError', async () => {
      prisma.user.create.mockRejectedValue(prismaError('P2002'));

      await expect(service.signup(input)).rejects.toBeInstanceOf(UserAlreadyExistsError);
    });

    it('rethrows unexpected errors as-is', async () => {
      prisma.user.create.mockRejectedValue(new Error('database unreachable'));

      await expect(service.signup(input)).rejects.toThrow('database unreachable');
    });
  });

  describe('signin', () => {
    const credentials = { email: 'alice@example.com', password: 'str0ng-password-1234' };

    beforeEach(() => {
      mocks.verifyPassword.mockResolvedValue(false);
      mocks.signToken.mockResolvedValue('token');
      mocks.hashPassword.mockResolvedValue('dummy-hash');
    });

    it('returns a token and the user for valid credentials', async () => {
      const user = makeUser();
      primary.user.findUnique.mockResolvedValue(user);
      mocks.verifyPassword.mockResolvedValue(true);

      await expect(service.signin(credentials)).resolves.toEqual({
        token: 'token',
        user: toUserResponse(user),
      });
    });

    it('looks the user up on the primary client', async () => {
      primary.user.findUnique.mockResolvedValue(makeUser());
      mocks.verifyPassword.mockResolvedValue(true);

      await service.signin(credentials);

      expect(primary.user.findUnique).toHaveBeenCalledWith({ where: { email: credentials.email } });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('verifies the password against the stored hash', async () => {
      const user = makeUser();
      primary.user.findUnique.mockResolvedValue(user);
      mocks.verifyPassword.mockResolvedValue(true);

      await service.signin(credentials);

      expect(mocks.verifyPassword).toHaveBeenCalledWith(credentials.password, user.password);
    });

    it('rejects when the user does not exist', async () => {
      primary.user.findUnique.mockResolvedValue(null);

      await expect(service.signin(credentials)).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('rejects when the password does not match', async () => {
      primary.user.findUnique.mockResolvedValue(makeUser());

      await expect(service.signin(credentials)).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('still verifies a dummy hash when the user is missing', async () => {
      primary.user.findUnique.mockResolvedValue(null);

      await expect(service.signin(credentials)).rejects.toBeInstanceOf(InvalidCredentialsError);
      expect(mocks.verifyPassword).toHaveBeenCalledWith(credentials.password, expect.any(String));
    });
  });

  describe('findById', () => {
    it('returns the mapped user', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await expect(service.findById('u1')).resolves.toEqual(toUserResponse(makeUser()));
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } });
    });

    it('returns null when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('u1')).resolves.toBeNull();
    });

    it('caches the user on a cache miss', async () => {
      mocks.redis.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await service.findById('u1');

      expect(mocks.redis.set).toHaveBeenCalledWith(
        'user:u1',
        JSON.stringify(toUserResponse(makeUser())),
        'PX',
        3600000,
      );
    });

    it('serves from cache on a hit without querying the database', async () => {
      mocks.redis.get.mockResolvedValue(JSON.stringify(toUserResponse(makeUser())));

      await expect(service.findById('u1')).resolves.toEqual(toUserResponse(makeUser()));
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('falls back to the database when redis.get fails', async () => {
      mocks.redis.get.mockRejectedValue(new Error('redis unavailable'));
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await expect(service.findById('u1')).resolves.toEqual(toUserResponse(makeUser()));
    });

    it('does not cache a miss', async () => {
      mocks.redis.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);

      await service.findById('u1');

      expect(mocks.redis.set).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns all users when no cursor is given', async () => {
      const users = [makeUser({ id: 'u2' }), makeUser({ id: 'u1' })];
      prisma.user.findMany.mockResolvedValue(users);

      await expect(service.findAll({ limit: 10 })).resolves.toEqual(users.map(toUserResponse));
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        take: 10,
        skip: 0,
        cursor: undefined,
        orderBy: { id: 'desc' },
      });
    });

    it('skips the cursor user when paginating', async () => {
      prisma.user.findMany.mockResolvedValue([makeUser({ id: 'u1' })]);

      const result = await service.findAll({ limit: 10, cursor: 'u2' });

      expect(result).toEqual([toUserResponse(makeUser({ id: 'u1' }))]);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        take: 10,
        skip: 1,
        cursor: { id: 'u2' },
        orderBy: { id: 'desc' },
      });
    });

    it('returns an empty list when there are no users', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await expect(service.findAll({ limit: 10 })).resolves.toEqual([]);
    });

    it('uses a cache key that includes the page parameters', async () => {
      mocks.redis.get.mockResolvedValue(null);
      prisma.user.findMany.mockResolvedValue([makeUser()]);

      await service.findAll({ limit: 10, cursor: 'u2' });

      expect(mocks.redis.set).toHaveBeenCalledWith(
        'users:10:u2',
        JSON.stringify([toUserResponse(makeUser())]),
        'PX',
        3600000,
      );
    });

    it('returns an empty list when the cached value is null', async () => {
      mocks.redis.get.mockResolvedValue('null');

      await expect(service.findAll({ limit: 10 })).resolves.toEqual([]);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('falls back to the database when redis.get fails', async () => {
      mocks.redis.get.mockRejectedValue(new Error('redis unavailable'));
      prisma.user.findMany.mockResolvedValue([makeUser()]);

      await expect(service.findAll({ limit: 10 })).resolves.toEqual([toUserResponse(makeUser())]);
    });
  });

  describe('updateProfile', () => {
    const data = { name: 'Alice Updated', bio: 'Hello' };

    it('updates the user and returns the mapped result', async () => {
      prisma.user.update.mockResolvedValue(makeUser({ ...data }));

      await expect(service.updateProfile('u1', data)).resolves.toEqual(
        toUserResponse(makeUser({ ...data })),
      );
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data });
    });

    it('invalidates the user and list caches', async () => {
      mocks.redis.del.mockResolvedValue(1);
      mocks.redis.keys.mockResolvedValue(['users:10:']);
      prisma.user.update.mockResolvedValue(makeUser({ ...data }));

      await service.updateProfile('u1', data);

      expect(mocks.redis.del).toHaveBeenCalledWith('user:u1');
      expect(mocks.redis.keys).toHaveBeenCalledWith('users:*');
      expect(mocks.redis.del).toHaveBeenCalledWith('users:10:');
    });

    it('maps a missing record to UserNotFoundError', async () => {
      prisma.user.update.mockRejectedValue(prismaError('P2025'));

      await expect(service.updateProfile('u1', data)).rejects.toBeInstanceOf(UserNotFoundError);
    });

    it('maps a unique-constraint violation to UserAlreadyExistsError', async () => {
      prisma.user.update.mockRejectedValue(prismaError('P2002'));

      await expect(service.updateProfile('u1', data)).rejects.toBeInstanceOf(
        UserAlreadyExistsError,
      );
    });
  });
});