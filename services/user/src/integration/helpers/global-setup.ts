import { applyTestEnv } from './env.js';
import { startContainers, stopContainers } from './containers.js';

export async function setup(): Promise<() => Promise<void>> {
  const { postgres, redis } = await startContainers();
  applyTestEnv(postgres, redis);

  return () => stopContainers();
}