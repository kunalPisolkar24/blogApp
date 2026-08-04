import { ApolloServer } from '@apollo/server';
import { HeaderMap } from '@apollo/server';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { GraphQLError, type GraphQLFormattedError } from 'graphql';
import { Hono } from 'hono';
import { env } from './config/env.js';
import { createContext } from './context.js';
import { DomainError, ValidationError } from './errors.js';
import { resolvers } from './graphql/resolvers.js';
import { typeDefs } from './graphql/typeDefs.js';
import { CacheManager } from './lib/cache.js';
import { prisma, primaryDb } from './lib/prisma.js';
import { pingRedis, redis } from './lib/redis.js';
import { UserRepository } from './repositories/user.repository.js';
import { UserService } from './user.service.js';

function unwrapDomain(error: unknown): DomainError | null {
  const inner =
    error instanceof Error && 'originalError' in error
      ? (error as { originalError?: unknown }).originalError
      : error;
  return inner instanceof DomainError ? inner : null;
}

function formatError(
  formatted: GraphQLFormattedError,
  error: unknown,
): GraphQLFormattedError {
  const domain = unwrapDomain(error);
  if (domain) {
    return {
      message: domain.message,
      path: formatted.path,
      extensions: { code: domain.code },
    };
  }
  if (error instanceof GraphQLError && error.originalError === undefined) {
    return formatted;
  }
  return { message: 'Internal server error', extensions: { code: 'INTERNAL_ERROR' } };
}

export async function buildApp(): Promise<Hono> {
  const userService = new UserService(
    new UserRepository(prisma, primaryDb()),
    new CacheManager(redis),
    env.REDIS_CACHE_TTL_MS,
  );

  const apollo = new ApolloServer({
    schema: buildSubgraphSchema({
      typeDefs,
      // resolvers expect GraphQLContext; buildSubgraphSchema's resolver type has context unknown
      resolvers: resolvers as any,
    }),
    formatError,
  });
  await apollo.start();

  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof DomainError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.httpStatus);
    }
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  });

  app.post('/graphql', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON');
    }

    const response = await apollo.executeHTTPGraphQLRequest({
      httpGraphQLRequest: {
        method: c.req.method,
        headers: new HeaderMap(c.req.raw.headers),
        search: new URL(c.req.url).search,
        body,
      },
      context: () => createContext(c, userService),
    });

    return new Response(response.body.kind === 'complete' ? response.body.string : null, {
      status: response.status ?? 200,
      headers: Object.fromEntries(response.headers),
    });
  });

  app.get('/', (c) => c.text('user service running'));
  app.get('/health', async (c) => c.json({ status: 'ok', redis: await pingRedis() }));

  return app;
}
