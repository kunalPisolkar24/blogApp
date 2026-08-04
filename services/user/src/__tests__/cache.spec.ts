import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheManager } from '../lib/cache.js';
import type { Redis } from 'ioredis';

const createRedisMocks = () => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
});

type RedisMocks = ReturnType<typeof createRedisMocks>;

const miss = (value: unknown) => vi.fn(async () => value);

describe('CacheManager', () => {
  let redis: RedisMocks;
  let cache: CacheManager;

  beforeEach(() => {
    redis = createRedisMocks();
    cache = new CacheManager(redis as unknown as Redis);
  });

  describe('read', () => {
    it('serves the parsed value from cache on a hit', async () => {
      redis.get.mockResolvedValue('{"id":"u1"}');

      await expect(cache.read('user:u1', 3600000, miss({ id: 'other' }))).resolves.toEqual({
        id: 'u1',
      });
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('fetches and stores the value on a miss', async () => {
      redis.get.mockResolvedValue(null);

      await expect(cache.read('user:u1', 3600000, miss({ id: 'u1' }))).resolves.toEqual({
        id: 'u1',
      });
      expect(redis.set).toHaveBeenCalledWith(
        'user:u1',
        JSON.stringify({ id: 'u1' }),
        'PX',
        3600000,
      );
    });

    it('does not store a miss', async () => {
      redis.get.mockResolvedValue(null);

      await expect(cache.read('user:u1', 3600000, miss(null))).resolves.toBeNull();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('falls back to the miss function when redis.get fails', async () => {
      redis.get.mockRejectedValue(new Error('redis unavailable'));

      await expect(cache.read('user:u1', 3600000, miss({ id: 'u1' }))).resolves.toEqual({
        id: 'u1',
      });
    });

    it('still returns the value when the cache write fails', async () => {
      redis.get.mockResolvedValue(null);
      redis.set.mockRejectedValue(new Error('write failed'));

      await expect(cache.read('user:u1', 3600000, miss({ id: 'u1' }))).resolves.toEqual({
        id: 'u1',
      });
    });

    it('bypasses redis entirely when no client is configured', async () => {
      const noop = new CacheManager(null);

      await expect(noop.read('user:u1', 3600000, miss({ id: 'u1' }))).resolves.toEqual({
        id: 'u1',
      });
      expect(redis.get).not.toHaveBeenCalled();
    });
  });

  describe('invalidateKey', () => {
    it('deletes the key', async () => {
      await cache.invalidateKey('user:u1');

      expect(redis.del).toHaveBeenCalledWith('user:u1');
    });

    it('swallows redis failures', async () => {
      redis.del.mockRejectedValue(new Error('redis unavailable'));

      await expect(cache.invalidateKey('user:u1')).resolves.toBeUndefined();
    });
  });

  describe('invalidateUserLists', () => {
    it('deletes all matching list keys', async () => {
      redis.keys.mockResolvedValue(['users:10:', 'users:20:u1']);

      await cache.invalidateUserLists();

      expect(redis.keys).toHaveBeenCalledWith('users:*');
      expect(redis.del).toHaveBeenCalledWith('users:10:', 'users:20:u1');
    });

    it('does nothing when there are no matching keys', async () => {
      redis.keys.mockResolvedValue([]);

      await cache.invalidateUserLists();

      expect(redis.del).not.toHaveBeenCalled();
    });

    it('swallows redis failures', async () => {
      redis.keys.mockRejectedValue(new Error('redis unavailable'));

      await expect(cache.invalidateUserLists()).resolves.toBeUndefined();
    });
  });

  it('is a no-op when no redis client is configured', async () => {
    const noop = new CacheManager(null);

    await expect(noop.invalidateKey('user:u1')).resolves.toBeUndefined();
    await expect(noop.invalidateUserLists()).resolves.toBeUndefined();
    expect(redis.del).not.toHaveBeenCalled();
    expect(redis.keys).not.toHaveBeenCalled();
  });
});
