import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { setupGracefulShutdown } from './lib/shutdown.js';

const app = new Hono();

app.get('/', (c) => c.text('user service running'));
app.get('/health', (c) => c.json({ status: 'ok' }));

const port = Number(process.env.PORT ?? 4001);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`user service listening on ${info.port}`);
});

setupGracefulShutdown(server);
