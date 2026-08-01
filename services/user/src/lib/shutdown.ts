import type { ServerType } from '@hono/node-server';

export function setupGracefulShutdown(server: ServerType): void {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      console.log(`${signal} received, shutting down`);
      server.close(() => process.exit(0));
      setTimeout(() => {
        console.error('shutdown timed out, forcing exit');
        process.exit(1);
      }, 10_000).unref();
    });
  }
}
