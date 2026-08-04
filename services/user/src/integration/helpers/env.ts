import { execFileSync } from 'node:child_process';
import type { StartedTestContainer } from 'testcontainers';

const JWT_SECRET = 'integration-test-secret-0123456789abcdef';

export function applyTestEnv(postgres: StartedTestContainer, redis: StartedTestContainer): void {
  const databaseUrl = `postgresql://topos_user:topos_pass@${postgres.getHost()}:${postgres.getMappedPort(5432)}/topos_users`;
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

  applyMigrations(databaseUrl);

  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_URL_MIGRATE = databaseUrl;
  process.env.DATABASE_URL_REPLICA = '';
  process.env.REDIS_URL = redisUrl;
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.JWT_ISSUER = 'user-service';
  process.env.JWT_AUDIENCE = 'topos';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.REDIS_CACHE_TTL_MS = '30000';
}

function applyMigrations(databaseUrl: string): void {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_URL_MIGRATE: databaseUrl,
    },
    stdio: 'pipe',
  });
}