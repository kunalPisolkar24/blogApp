import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { env } from './config/env.js';
import { setupGracefulShutdown } from './lib/shutdown.js';

const app = new Hono();

app.get('/', (c) => c.text('user service running'));
app.get('/health', (c) => c.json({ status: 'ok' }));

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`user service listening on ${info.port}`);
});

setupGracefulShutdown(server);
