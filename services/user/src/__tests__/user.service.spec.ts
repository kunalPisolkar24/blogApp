import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserService } from '../user.service.js';
import { toUserResponse } from '../domain/user.js';
import { CacheManager } from '../lib/cache.js';
import { UserRepository } from '../repositories/user.repository.js';
import { InvalidCredentialsError, UserAlreadyExistsError } from '../errors.js';
import type { User } from '../generated/prisma/client.js';

const mocks = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  getDummyHash: vi.fn(),
  signToken: vi.fn(),
}));

vi.mock('../utils/password.js', () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
  getDummyHash: mocks.getDummyHash,
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

const createUserMocks = () => ({
  create: vi.fn(),
  findByEmail: vi.fn(),
  findByEmailOrUsername: vi.fn(),
  findById: vi.fn(),
  findAll: vi.fn(),
  update: vi.fn(),
});

const createCacheMocks = () => ({
  read: vi.fn(async (_key: string, _ttl: number, miss: () => Promise<unknown>) => miss()),
  invalidateKey: vi.fn(),
  invalidateUserLists: vi.fn(),
});

type UserMocks = ReturnType<typeof createUserMocks>;
type CacheMocks = ReturnType<typeof createCacheMocks>;

describe('UserService', () => {
  let service: UserService;
  let users: UserMocks;
  let cache: CacheMocks;

  beforeEach(() => {
    vi.resetAllMocks();
    users = createUserMocks();
    cache = createCacheMocks();
    service = new UserService(
      users as unknown as UserRepository,
      cache as unknown as CacheManager,
      3600000,
    );
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
      users.findByEmailOrUsername.mockResolvedValue(null);
      users.create.mockResolvedValue(makeUser());
    });

    it('hashes the password before storing the user', async () => {
      await service.signup(input);

      expect(mocks.hashPassword).toHaveBeenCalledWith(input.password);
      expect(users.create).toHaveBeenCalledWith({
        email: input.email,
        username: input.username,
        password: 'hashed-password',
        name: input.username,
      });
    });

    it('rejects duplicates without hashing the password', async () => {
      users.findByEmailOrUsername.mockResolvedValue(makeUser());

      await expect(service.signup(input)).rejects.toBeInstanceOf(UserAlreadyExistsError);
      expect(mocks.hashPassword).not.toHaveBeenCalled();
      expect(users.create).not.toHaveBeenCalled();
    });

    it('returns a token and the new user', async () => {
      await expect(service.signup(input)).resolves.toEqual({
        token: 'token',
        user: toUserResponse(makeUser()),
      });
    });

    it('invalidates the user list caches', async () => {
      await service.signup(input);

      expect(cache.invalidateUserLists).toHaveBeenCalledTimes(1);
    });
  });

  describe('signin', () => {
    const credentials = { email: 'alice@example.com', password: 'str0ng-password-1234' };

    beforeEach(() => {
      mocks.verifyPassword.mockResolvedValue(false);
      mocks.signToken.mockResolvedValue('token');
      mocks.getDummyHash.mockResolvedValue('dummy-hash');
    });

    it('returns a token and the user for valid credentials', async () => {
      const user = makeUser();
      users.findByEmail.mockResolvedValue(user);
      mocks.verifyPassword.mockResolvedValue(true);

      await expect(service.signin(credentials)).resolves.toEqual({
        token: 'token',
        user: toUserResponse(user),
      });
    });

    it('looks the user up by email', async () => {
      users.findByEmail.mockResolvedValue(makeUser());
      mocks.verifyPassword.mockResolvedValue(true);

      await service.signin(credentials);

      expect(users.findByEmail).toHaveBeenCalledWith(credentials.email);
    });

    it('verifies the password against the stored hash', async () => {
      const user = makeUser();
      users.findByEmail.mockResolvedValue(user);
      mocks.verifyPassword.mockResolvedValue(true);

      await service.signin(credentials);

      expect(mocks.verifyPassword).toHaveBeenCalledWith(credentials.password, user.password);
    });

    it('rejects when the user does not exist', async () => {
      users.findByEmail.mockResolvedValue(null);

      await expect(service.signin(credentials)).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('rejects when the password does not match', async () => {
      users.findByEmail.mockResolvedValue(makeUser());

      await expect(service.signin(credentials)).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('still verifies a dummy hash when the user is missing', async () => {
      users.findByEmail.mockResolvedValue(null);

      await expect(service.signin(credentials)).rejects.toBeInstanceOf(InvalidCredentialsError);
      expect(mocks.getDummyHash).toHaveBeenCalled();
      expect(mocks.verifyPassword).toHaveBeenCalledWith(credentials.password, 'dummy-hash');
    });
  });

  describe('findById', () => {
    it('returns the mapped user', async () => {
      users.findById.mockResolvedValue(makeUser());

      await expect(service.findById('u1')).resolves.toEqual(toUserResponse(makeUser()));
      expect(users.findById).toHaveBeenCalledWith('u1');
    });

    it('returns null when the user does not exist', async () => {
      users.findById.mockResolvedValue(null);

      await expect(service.findById('u1')).resolves.toBeNull();
    });

    it('reads through the cache with the user key and ttl', async () => {
      users.findById.mockResolvedValue(makeUser());

      await service.findById('u1');

      expect(cache.read).toHaveBeenCalledWith('user:u1', 3600000, expect.any(Function));
    });
  });

  describe('findAll', () => {
    it('returns the mapped users when no cursor is given', async () => {
      const all = [makeUser({ id: 'u2' }), makeUser({ id: 'u1' })];
      users.findAll.mockResolvedValue(all);

      await expect(service.findAll({ limit: 10 })).resolves.toEqual(all.map(toUserResponse));
      expect(users.findAll).toHaveBeenCalledWith({ limit: 10, cursor: undefined });
    });

    it('forwards the cursor', async () => {
      users.findAll.mockResolvedValue([]);

      await service.findAll({ limit: 10, cursor: 'u2' });

      expect(users.findAll).toHaveBeenCalledWith({ limit: 10, cursor: 'u2' });
    });

    it('returns an empty list when the cached value is null', async () => {
      cache.read.mockResolvedValue(null);

      await expect(service.findAll({ limit: 10 })).resolves.toEqual([]);
    });

    it('uses a cache key that includes the page parameters', async () => {
      users.findAll.mockResolvedValue([]);

      await service.findAll({ limit: 10, cursor: 'u2' });

      expect(cache.read).toHaveBeenCalledWith('users:10:u2', 3600000, expect.any(Function));
    });
  });

  describe('updateProfile', () => {
    const data = { name: 'Alice Updated', bio: 'Hello' };

    it('updates the user and returns the mapped result', async () => {
      users.update.mockResolvedValue(makeUser({ ...data }));

      await expect(service.updateProfile('u1', data)).resolves.toEqual(
        toUserResponse(makeUser({ ...data })),
      );
      expect(users.update).toHaveBeenCalledWith('u1', data);
    });

    it('invalidates the user and list caches', async () => {
      users.update.mockResolvedValue(makeUser());

      await service.updateProfile('u1', data);

      expect(cache.invalidateKey).toHaveBeenCalledWith('user:u1');
      expect(cache.invalidateUserLists).toHaveBeenCalledTimes(1);
    });
  });
});
