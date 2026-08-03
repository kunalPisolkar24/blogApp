import { ApolloServer } from '@apollo/server';
import { HeaderMap } from '@apollo/server';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { Hono } from 'hono';
import { resolvers } from './graphql/resolvers.js';
import { typeDefs } from './graphql/typeDefs.js';

export async function buildApp(): Promise<Hono> {
  const apollo = new ApolloServer({
    schema: buildSubgraphSchema({ typeDefs, resolvers }),
  });
  await apollo.start();

  const app = new Hono();

  app.post('/graphql', async (c) => {
    const response = await apollo.executeHTTPGraphQLRequest({
      httpGraphQLRequest: {
        method: c.req.method,
        headers: new HeaderMap(c.req.raw.headers),
        search: new URL(c.req.url).search,
        body: await c.req.json(),
      },
      context: async () => ({}),
    });

    return new Response(response.body.kind === 'complete' ? response.body.string : null, {
      status: response.status ?? 200,
      headers: Object.fromEntries(response.headers),
    });
  });

  app.get('/', (c) => c.text('user service running'));
  app.get('/health', (c) => c.json({ status: 'ok' }));

  return app;
}
