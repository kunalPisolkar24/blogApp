import { env } from './config/env.js';
import { CacheManager } from './lib/cache.js';
import { prisma, primaryDb } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { Metrics } from './observability/metrics.js';
import { UserRepository } from './repositories/user.repository.js';
import { UserService } from './user.service.js';

export interface Services {
  metrics: Metrics;
  userService: UserService;
}

export function createServices(): Services {
  const metrics = new Metrics();
  const userService = new UserService(
    new UserRepository(prisma, primaryDb(), metrics),
    new CacheManager(redis, metrics),
    env.REDIS_CACHE_TTL_MS,
    metrics,
  );
  return { metrics, userService };
}