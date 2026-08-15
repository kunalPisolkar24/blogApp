import { describe, it, expect, vi, afterEach } from 'vitest';
import client from 'prom-client';
import { createApolloServer } from '../server.js';
import type { GraphQLContext } from '../../context.js';

const mocks = vi.hoisted(() => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'info' },
}));

vi.mock('../../config/env.js', () => ({ env: mocks.env }));

type UserServiceLike = GraphQLContext['userService'];

function makeContext(overrides: Partial<GraphQLContext> = {}): GraphQLContext {
  return {
    user: null,
    userService: {
      findById: vi.fn(),
      findAll: vi.fn(),
      signup: vi.fn(),
      signin: vi.fn(),
      updateProfile: vi.fn(),
    } as unknown as UserServiceLike,
    ...overrides,
  };
}

async function singleResult(
  apollo: Awaited<ReturnType<typeof createApolloServer>>,
  query: string,
  contextValue: GraphQLContext,
): Promise<{ data?: unknown; errors?: readonly unknown[] }> {
  const result = await apollo.executeOperation({ query }, { contextValue });
  if (result.body.kind !== 'single') {
    throw new Error('expected a single execution result');
  }
  return result.body.singleResult;
}

describe('createApolloServer', () => {
  afterEach(() => {
    client.register.clear();
  });

  it('starts and serves the user subgraph', async () => {
    const apollo = await createApolloServer();

    const result = await singleResult(apollo, '{ __typename }', makeContext());

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ __typename: 'Query' });
  });

  it('returns null for me when unauthenticated', async () => {
    const apollo = await createApolloServer();

    const result = await singleResult(apollo, '{ me { id } }', makeContext());

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ me: null });
  });

  it('maps validation errors to the VALIDATION_ERROR code', async () => {
    const apollo = await createApolloServer();

    const result = await singleResult(
      apollo,
      '{ users(cursor: "not-a-uuid") { id } }',
      makeContext(),
    );

    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toMatchObject({
      message: 'cursor must be a valid user id',
      extensions: { code: 'VALIDATION_ERROR' },
    });
  });
});