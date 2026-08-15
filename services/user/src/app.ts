import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { createServices } from './container.js';
import { DomainError } from './errors.js';
import { createApolloServer } from './graphql/server.js';
import { graphqlHandler, healthHandler, metricsHandler } from './http/handlers.js';
import { pingDb } from './lib/prisma.js';
import { pingRedis } from './lib/redis.js';
import { logger } from './observability/logger.js';
import { requestLogging, requestMetrics } from './observability/middleware.js';

export async function buildApp(): Promise<Hono> {
  const { metrics, userService } = createServices();
  const apollo = await createApolloServer();

  const app = new Hono();

  app.use(requestId());
  app.use(requestLogging(logger));
  app.use(requestMetrics(metrics));

  app.onError((error, c) => {
    if (error instanceof DomainError) {
      logger.info({ code: error.code }, error.message);
      return c.json({ error: { code: error.code, message: error.message } }, error.httpStatus);
    }
    logger.error(error, 'unhandled error');
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  });

  app.post('/graphql', graphqlHandler({ apollo, userService, metrics }));
  app.get('/metrics', metricsHandler(metrics));
  app.get('/', (c) => c.text('user service running'));
  app.get('/health', healthHandler({ pingDb, pingRedis }));

  return app;
}