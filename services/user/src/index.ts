import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const app = new Hono();

app.get('/', (c) => c.text('user service running'));
app.get('/health', (c) => c.json({ status: 'ok' }));

const port = Number(process.env.PORT ?? 4001);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`user service listening on ${info.port}`);
});
