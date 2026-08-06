import type { Redis } from 'ioredis';
import type { Metrics } from '../observability/metrics.js';

export class CacheManager {
  constructor(
    private readonly redis: Redis | null,
    private readonly metrics?: Metrics,
  ) {}

  async read<T>(key: string, ttlMs: number, miss: () => Promise<T | null>): Promise<T | null> {
    if (!this.redis) {
      return miss();
    }
    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch {
      this.metrics?.recordCacheRead('read_error');
      return miss();
    }
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw) as T;
        this.metrics?.recordCacheRead('hit');
        return parsed;
      } catch {
        this.metrics?.recordCacheRead('read_error');
        return miss();
      }
    }
    this.metrics?.recordCacheRead('miss');
    const value = await miss();
    if (value !== null) {
      try {
        await this.redis.set(key, JSON.stringify(value), 'PX', ttlMs);
      } catch {
        this.metrics?.recordCacheRead('write_error');
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
      this.metrics?.recordCacheInvalidation('key', 'ok');
    } catch {
      this.metrics?.recordCacheInvalidation('key', 'error');
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
      this.metrics?.recordCacheInvalidation('lists', 'ok');
    } catch {
      this.metrics?.recordCacheInvalidation('lists', 'error');
    }
  }
}