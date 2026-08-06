import type { ServerType } from '@hono/node-server';
import { closeRedis } from './redis.js';

export function setupGracefulShutdown(server: ServerType): void {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      console.log(`${signal} received, shutting down`);
      server.close(async () => {
        await closeRedis();
        process.exit(0);
      });
      setTimeout(() => {
        console.error('shutdown timed out, forcing exit');
        process.exit(1);
      }, 10_000).unref();
    });
  }
}
