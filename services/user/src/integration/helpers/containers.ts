import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';

const POSTGRES_IMAGE = 'postgres:16-alpine';
const REDIS_IMAGE = 'redis:7.2-alpine';

const containers: StartedTestContainer[] = [];

export async function startContainers(): Promise<{
  postgres: StartedTestContainer;
  redis: StartedTestContainer;
}> {
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

  return { postgres, redis };
}

export async function stopContainers(): Promise<void> {
  for (const container of containers) {
    try {
      await container.stop();
    } catch {
      // ignore stop errors during teardown
    }
  }
  containers.length = 0;
}