import { serve } from '@hono/node-server';
import { env } from './config/env.js';
import { buildApp } from './app.js';
import { setupGracefulShutdown } from './lib/shutdown.js';

const app = await buildApp();

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`user service listening on ${info.port}`);
});

setupGracefulShutdown(server);
