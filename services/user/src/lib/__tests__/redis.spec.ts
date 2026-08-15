import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { pingRedis } from '../redis.js';

vi.mock('../../config/env.js', () => ({ env: {} }));

describe('pingRedis', () => {
  it('returns unavailable when no redis client is configured', async () => {
    await expect(pingRedis(null)).resolves.toBe('unavailable');
  });

  it('returns ok when the redis client responds', async () => {
    const client = { ping: vi.fn().mockResolvedValue('PONG') } as unknown as Redis;

    await expect(pingRedis(client)).resolves.toBe('ok');
  });

  it('returns unavailable when the redis ping fails', async () => {
    const client = { ping: vi.fn().mockRejectedValue(new Error('connection refused')) } as unknown as Redis;

    await expect(pingRedis(client)).resolves.toBe('unavailable');
  });

  it('returns unavailable when the ping hangs past the timeout', async () => {
    const client = {
      ping: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve('PONG'), 5000))),
    } as unknown as Redis;

    await expect(pingRedis(client)).resolves.toBe('unavailable');
  });
});