import { serve } from '@hono/node-server';
import { env } from './config/env.js';
import { buildApp } from './app.js';
import { setupGracefulShutdown } from './lib/shutdown.js';
import { logger } from './observability/logger.js';
import { setupTracing } from './observability/tracing.js';

setupTracing();

const app = await buildApp();

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(`user service listening on ${info.port}`);
});

setupGracefulShutdown(server);
