import { execFileSync } from 'node:child_process';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';

const POSTGRES_IMAGE = 'postgres:16-alpine';
const REDIS_IMAGE = 'redis:7.2-alpine';

const JWT_SECRET = 'integration-test-secret-0123456789abcdef';

const containers: StartedTestContainer[] = [];

export async function setup(): Promise<() => Promise<void>> {
  const postgres = await new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_USER: 'topos_user',
      POSTGRES_PASSWORD: 'topos_pass',
      POSTGRES_DB: 'topos_users',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections'))
    .withStartupTimeout(60_000)
    .start();
  containers.push(postgres);

  const redis = await new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .withStartupTimeout(30_000)
    .start();
  containers.push(redis);

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

  return async () => {
    for (const container of containers) {
      try {
        await container.stop();
      } catch {
        // ignore stop errors during teardown
      }
    }
    containers.length = 0;
  };
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