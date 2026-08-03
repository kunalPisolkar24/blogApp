import { parse } from 'graphql';

export const typeDefs = parse(`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key"])

  type User @key(fields: "id") {
    id: ID!
  }

  type Query {
    _: Boolean
  }
`);
