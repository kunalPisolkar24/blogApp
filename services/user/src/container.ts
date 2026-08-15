import { env } from './config/env.js';
import { CacheManager } from './lib/cache.js';
import { prisma, primaryDb, primaryPool, replicaPool } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { Metrics, type DbPoolRegistration } from './observability/metrics.js';
import { UserRepository } from './repositories/user.repository.js';
import { UserService } from './user.service.js';

export interface Services {
  metrics: Metrics;
  userService: UserService;
}

export function createServices(): Services {
  const metrics = new Metrics();
  const pools: DbPoolRegistration[] = [
    { node: 'primary', pool: primaryPool },
    ...(replicaPool ? [{ node: 'replica' as const, pool: replicaPool }] : []),
  ];
  metrics.registerDbPools(pools);
  metrics.registerRedis(redis);
  const userService = new UserService(
    new UserRepository(prisma, primaryDb(), metrics),
    new CacheManager(redis, metrics),
    env.REDIS_CACHE_TTL_MS,
    metrics,
  );
  return { metrics, userService };
}