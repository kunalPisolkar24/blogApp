import { describe, it, expect, vi, beforeEach } from 'vitest';
import client from 'prom-client';
import { createServices } from '../container.js';
import { Metrics } from '../observability/metrics.js';
import { UserService } from '../user.service.js';

const mocks = vi.hoisted(() => ({
  env: { NODE_ENV: 'test', REDIS_CACHE_TTL_MS: 3600000 },
}));

vi.mock('../config/env.js', () => ({ env: mocks.env }));
vi.mock('../lib/prisma.js', () => ({
  prisma: {},
  primaryDb: () => ({}),
}));
vi.mock('../lib/redis.js', () => ({ redis: null }));

describe('createServices', () => {
  beforeEach(() => {
    client.register.clear();
  });

  it('returns a metrics registry and a user service', () => {
    const services = createServices();

    expect(services.metrics).toBeInstanceOf(Metrics);
    expect(services.userService).toBeInstanceOf(UserService);
  });

  it('returns fresh instances on each call', () => {
    const first = createServices();
    client.register.clear();
    const second = createServices();

    expect(first.metrics).not.toBe(second.metrics);
    expect(first.userService).not.toBe(second.userService);
  });
});