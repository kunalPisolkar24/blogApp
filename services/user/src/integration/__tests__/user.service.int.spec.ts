import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { UserService } from '../../user.service.js';
import { prisma, primaryDb } from '../../lib/prisma.js';
import { redis as rawRedis } from '../../lib/redis.js';
import { verifyToken } from '../../utils/token.js';
import { CacheManager } from '../../lib/cache.js';
import { UserRepository } from '../../repositories/user.repository.js';
import { InvalidCredentialsError, UserAlreadyExistsError } from '../../errors.js';
import { env } from '../../config/env.js';

const PASSWORD = 'correct-horse-battery-123';
const redis = rawRedis!;

describe('UserService integration', () => {
  let service: UserService;

  beforeAll(() => {
    service = new UserService(
      new UserRepository(prisma, primaryDb()),
      new CacheManager(redis),
      env.REDIS_CACHE_TTL_MS,
    );
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
    await redis.flushall();
  });

  afterAll(async () => {
    redis.disconnect();
    await prisma.$disconnect();
  });

  describe('signup', () => {
    it('creates a user with a hashed password and a valid token', async () => {
      const result = await service.signup({
        email: 'alice@example.com',
        username: 'alice',
        password: PASSWORD,
      });

      expect(result.user.username).toBe('alice');
      expect(result.user.name).toBe('alice');
      await expect(verifyToken(result.token)).resolves.toEqual({ id: result.user.id });

      const stored = await prisma.user.findUnique({ where: { id: result.user.id } });
      expect(stored?.password).toMatch(/^scrypt:/);
      expect(stored?.password).not.toBe(PASSWORD);
    });

    it('rejects a duplicate email', async () => {
      await service.signup({
        email: 'alice@example.com',
        username: 'alice',
        password: PASSWORD,
      });

      await expect(
        service.signup({
          email: 'alice@example.com',
          username: 'alice2',
          password: PASSWORD,
        }),
      ).rejects.toBeInstanceOf(UserAlreadyExistsError);
    });

    it('rejects a duplicate username', async () => {
      await service.signup({
        email: 'alice@example.com',
        username: 'alice',
        password: PASSWORD,
      });

      await expect(
        service.signup({
          email: 'alice2@example.com',
          username: 'alice',
          password: PASSWORD,
        }),
      ).rejects.toBeInstanceOf(UserAlreadyExistsError);
    });

    it('invalidates cached user lists', async () => {
      await service.findAll({ limit: 10 });
      await expect(redis.get('users:10:')).resolves.not.toBeNull();

      await service.signup({
        email: 'alice@example.com',
        username: 'alice',
        password: PASSWORD,
      });

      await expect(redis.get('users:10:')).resolves.toBeNull();
    });
  });

  describe('signin', () => {
    it('returns a token and the user for valid credentials', async () => {
      const { user } = await service.signup({
        email: 'alice@example.com',
        username: 'alice',
        password: PASSWORD,
      });

      const result = await service.signin({ email: 'alice@example.com', password: PASSWORD });

      expect(result.user.id).toBe(user.id);
      await expect(verifyToken(result.token)).resolves.toEqual({ id: user.id });
    });

    it('rejects a wrong password', async () => {
      await service.signup({
        email: 'alice@example.com',
        username: 'alice',
        password: PASSWORD,
      });

      await expect(
        service.signin({ email: 'alice@example.com', password: 'wrong-password-1' }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('rejects an unknown email', async () => {
      await expect(
        service.signin({ email: 'nobody@example.com', password: PASSWORD }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });
  });

  describe('findById', () => {
    it('returns the mapped user', async () => {
      const { user } = await service.signup({
        email: 'alice@example.com',
        username: 'alice',
        password: PASSWORD,
      });

      await expect(service.findById(user.id)).resolves.toEqual(user);
    });

    it('returns null for an unknown id', async () => {
      await expect(service.findById('does-not-exist')).resolves.toBeNull();
    });

    it('caches the result in redis', async () => {
      const { user } = await service.signup({
        email: 'alice@example.com',
        username: 'alice',
        password: PASSWORD,
      });

      await service.findById(user.id);

      const cached = JSON.parse((await redis.get(`user:${user.id}`)) ?? 'null');
      expect(cached).toEqual(user);
    });

    it('serves from cache even after the user is deleted', async () => {
      const { user } = await service.signup({
        email: 'alice@example.com',
        username: 'alice',
        password: PASSWORD,
      });
      await service.findById(user.id);

      await prisma.user.delete({ where: { id: user.id } });

      await expect(service.findById(user.id)).resolves.toEqual(user);
    });
  });

  describe('findAll', () => {
    it('returns all users', async () => {
      await service.signup({ email: 'a@example.com', username: 'alice', password: PASSWORD });
      await service.signup({ email: 'b@example.com', username: 'bob', password: PASSWORD });
      await service.signup({ email: 'c@example.com', username: 'carol', password: PASSWORD });

      const users = await service.findAll({ limit: 10 });

      expect(users).toHaveLength(3);
      expect(users.map((u) => u.username).sort()).toEqual(['alice', 'bob', 'carol']);
    });

    it('paginates with a cursor', async () => {
      await service.signup({ email: 'a@example.com', username: 'alice', password: PASSWORD });
      await service.signup({ email: 'b@example.com', username: 'bob', password: PASSWORD });
      await service.signup({ email: 'c@example.com', username: 'carol', password: PASSWORD });

      const firstPage = await service.findAll({ limit: 2 });
      expect(firstPage).toHaveLength(2);

      const secondPage = await service.findAll({ limit: 2, cursor: firstPage[1].id });
      expect(secondPage).toHaveLength(1);
      expect(secondPage[0].id).not.toBe(firstPage[0].id);
      expect(secondPage[0].id).not.toBe(firstPage[1].id);
    });

    it('caches each page under its own key', async () => {
      await service.signup({ email: 'a@example.com', username: 'alice', password: PASSWORD });
      await service.signup({ email: 'b@example.com', username: 'bob', password: PASSWORD });
      await service.signup({ email: 'c@example.com', username: 'carol', password: PASSWORD });

      const firstPage = await service.findAll({ limit: 2 });
      const page = await service.findAll({ limit: 2, cursor: firstPage[1].id });

      expect(page).toHaveLength(1);

      const cached = JSON.parse((await redis.get(`users:2:${firstPage[1].id}`)) ?? 'null');
      expect(cached).toEqual(page);
    });
  });

  describe('updateProfile', () => {
    it('persists changes and returns the updated user', async () => {
      const { user } = await service.signup({
        email: 'alice@example.com',
        username: 'alice',
        password: PASSWORD,
      });

      const updated = await service.updateProfile(user.id, {
        name: 'Alice Updated',
        bio: 'Hello',
      });

      expect(updated.name).toBe('Alice Updated');
      expect(updated.bio).toBe('Hello');

      const stored = await prisma.user.findUnique({ where: { id: user.id } });
      expect(stored?.name).toBe('Alice Updated');
      expect(stored?.bio).toBe('Hello');
    });

    it('invalidates the cached user and user lists', async () => {
      const { user } = await service.signup({
        email: 'alice@example.com',
        username: 'alice',
        password: PASSWORD,
      });
      await service.findById(user.id);
      await service.findAll({ limit: 10 });

      await service.updateProfile(user.id, { name: 'Alice Updated' });

      await expect(redis.get(`user:${user.id}`)).resolves.toBeNull();
      await expect(redis.get('users:10:')).resolves.toBeNull();
    });
  });
});