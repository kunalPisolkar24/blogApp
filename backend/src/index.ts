import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { userRouter } from './routes/user';
import { postRouter } from './routes/posts';
import { tagRouter } from './routes/tags';
import { rateLimitMiddleware } from './middleware/rate-limit';

const app = new Hono<{
  Bindings: {
    DATABASE_URL: string,
    JWT_SECRET: string,
    DATABASE_URL_MIGRATE: string,
    UPSTASH_REDIS_REST_URL: string,
    UPSTASH_REDIS_REST_TOKEN: string,
    RAILWAY_CONSUMER_WAKEUP_URL: string,
    RAILWAY_WAKEUP_SECRET: string,
    UPSTASH_RATELIMIT_REDIS_REST_URL: string,
    UPSTASH_RATELIMIT_REDIS_REST_TOKEN: string
  };
}>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.use('*', rateLimitMiddleware);

app.get('/ping', (c) => {
  return c.json({
    status: 'ok',
    message: 'API Routes are working!',
    timestamp: new Date().toISOString(),
  });
});

app.route("/api", userRouter);
app.route("/api/posts", postRouter);
app.route("/api/tags", tagRouter);

export default app;
