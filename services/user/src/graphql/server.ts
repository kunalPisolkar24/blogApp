import { ApolloServer } from '@apollo/server';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { env } from '../config/env.js';
import { resolvers } from './resolvers.js';
import { typeDefs } from './typeDefs.js';
import { formatError } from './formatError.js';

export async function createApolloServer(): Promise<ApolloServer> {
  const apollo = new ApolloServer({
    schema: buildSubgraphSchema({
      typeDefs,
      // resolvers expect GraphQLContext; buildSubgraphSchema's resolver type has context unknown
      resolvers: resolvers as any,
    }),
    formatError,
    introspection: env.NODE_ENV !== 'production',
  });
  await apollo.start();
  return apollo;
}