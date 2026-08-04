import type { Redis } from 'ioredis';

export class CacheManager {
  constructor(private readonly redis: Redis | null) {}

  async read<T>(key: string, ttlMs: number, miss: () => Promise<T | null>): Promise<T | null> {
    if (!this.redis) {
      return miss();
    }
    try {
      const raw = await this.redis.get(key);
      if (raw !== null) {
        return JSON.parse(raw) as T;
      }
    } catch {
      return miss();
    }
    const value = await miss();
    if (value !== null) {
      try {
        await this.redis.set(key, JSON.stringify(value), 'PX', ttlMs);
      } catch {
        /* cache write is best-effort */
      }
    }
    return value;
  }

  async invalidateKey(key: string): Promise<void> {
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.del(key);
    } catch {
      /* cache invalidation is best-effort */
    }
  }

  async invalidateUserLists(): Promise<void> {
    if (!this.redis) {
      return;
    }
    try {
      const keys = await this.redis.keys('users:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch {
      /* cache invalidation is best-effort */
    }
  }
}