import { ApolloServer, HeaderMap } from '@apollo/server';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import client from 'prom-client';
import { DomainError, ValidationError } from '../../errors.js';
import { graphqlHandler, healthHandler, metricsHandler } from '../handlers.js';
import { Metrics } from '../../observability/metrics.js';
import type { UserService } from '../../user.service.js';

const mocks = vi.hoisted(() => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'info' },
}));

vi.mock('../../config/env.js', () => ({ env: mocks.env }));

type FakeApollo = Pick<ApolloServer, 'executeHTTPGraphQLRequest'>;

function fakeApollo(response: {
  body: { kind: 'complete' | 'incremental'; string: string };
  status?: number;
  headers?: HeaderMap;
}): FakeApollo {
  return {
    executeHTTPGraphQLRequest: vi.fn().mockResolvedValue({
      body: response.body,
      status: response.status ?? 200,
      headers: response.headers ?? new HeaderMap(),
    }),
  };
}

function buildApp(apollo: FakeApollo, metrics: Metrics): Hono {
  const app = new Hono();
  app.use(requestId());
  app.onError((error, c) => {
    if (error instanceof DomainError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.httpStatus);
    }
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  });
  app.post(
    '/graphql',
    graphqlHandler({
      apollo: apollo as unknown as ApolloServer,
      userService: {} as UserService,
      metrics,
    }),
  );
  return app;
}

describe('graphqlHandler', () => {
  afterEach(() => {
    client.register.clear();
  });

  it('rejects malformed JSON bodies with a 400 ValidationError', async () => {
    const metrics = new Metrics();
    const app = buildApp(fakeApollo({ body: { kind: 'complete', string: '{}' } }), metrics);

    const res = await app.request('/graphql', {
      method: 'POST',
      body: 'not-json',
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' },
    });
  });

  it('rejects bodies over the size limit with a 413 PayloadTooLarge', async () => {
    const metrics = new Metrics();
    const app = buildApp(fakeApollo({ body: { kind: 'complete', string: '{}' } }), metrics);
    const big = JSON.stringify({ query: 'x'.repeat(256 * 1024) });

    const res = await app.request('/graphql', {
      method: 'POST',
      body: big,
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the maximum allowed size' },
    });
  });

  it('forwards the apollo status, headers and body', async () => {
    const metrics = new Metrics();
    const headers = new HeaderMap([['content-type', 'application/json']]);
    const apollo = fakeApollo({
      body: { kind: 'complete', string: '{"data":{"me":null}}' },
      status: 200,
      headers,
    });
    const app = buildApp(apollo, metrics);

    const res = await app.request('/graphql', {
      method: 'POST',
      body: JSON.stringify({ query: '{ me { id } }' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.text()).toBe('{"data":{"me":null}}');
  });

  it('records a success metric when the response has no errors', async () => {
    const metrics = new Metrics();
    const app = buildApp(fakeApollo({ body: { kind: 'complete', string: '{"data":{}}' } }), metrics);

    await app.request('/graphql', {
      method: 'POST',
      body: JSON.stringify({ query: '{ me { id } }', operationName: 'me' }),
      headers: { 'content-type': 'application/json' },
    });

    const output = await metrics.getMetrics();
    expect(output).toContain('graphql_operations_total{operation="me",status="success"} 1');
  });

  it('records an error metric when the response contains errors', async () => {
    const metrics = new Metrics();
    const app = buildApp(
      fakeApollo({
        body: { kind: 'complete', string: '{"data":null,"errors":[{"message":"boom"}]}' },
      }),
      metrics,
    );

    await app.request('/graphql', {
      method: 'POST',
      body: JSON.stringify({ query: '{ me { id } }', operationName: 'me' }),
      headers: { 'content-type': 'application/json' },
    });

    const output = await metrics.getMetrics();
    expect(output).toContain('graphql_operations_total{operation="me",status="error"} 1');
  });

  it('records graphql error codes from the response body', async () => {
    const metrics = new Metrics();
    const app = buildApp(
      fakeApollo({
        body: {
          kind: 'complete',
          string:
            '{"data":null,"errors":[{"message":"bad creds","extensions":{"code":"INVALID_CREDENTIALS"}}]}',
        },
      }),
      metrics,
    );

    await app.request('/graphql', {
      method: 'POST',
      body: JSON.stringify({ query: '{ me { id } }', operationName: 'signin' }),
      headers: { 'content-type': 'application/json' },
    });

    const output = await metrics.getMetrics();
    expect(output).toContain(
      'graphql_errors_total{operation="signin",code="INVALID_CREDENTIALS"} 1',
    );
  });

  it('buckets unknown operation names into the unknown label', async () => {
    const metrics = new Metrics();
    const app = buildApp(
      fakeApollo({
        body: {
          kind: 'complete',
          string:
            '{"data":null,"errors":[{"message":"bad creds","extensions":{"code":"INVALID_CREDENTIALS"}}]}',
        },
      }),
      metrics,
    );

    await app.request('/graphql', {
      method: 'POST',
      body: JSON.stringify({ query: '{ me { id } }', operationName: 'randomName-12345' }),
      headers: { 'content-type': 'application/json' },
    });

    const output = await metrics.getMetrics();
    expect(output).toContain(
      'graphql_errors_total{operation="unknown",code="INVALID_CREDENTIALS"} 1',
    );
    expect(output).toContain('graphql_operations_total{operation="unknown",status="error"} 1');
    expect(output).not.toContain('randomName-12345');
  });
});

describe('healthHandler', () => {
  it('returns ok with the redis status', async () => {
    const app = new Hono();
    app.get('/health', healthHandler(() => Promise.resolve('ok')));

    const res = await app.request('/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', redis: 'ok' });
  });

  it('reports redis as unavailable when the ping fails', async () => {
    const app = new Hono();
    app.get('/health', healthHandler(() => Promise.resolve('unavailable')));

    const res = await app.request('/health');

    expect(await res.json()).toEqual({ status: 'ok', redis: 'unavailable' });
  });
});

describe('metricsHandler', () => {
  it('serves the prometheus registry', async () => {
    const metrics = new Metrics();
    const app = new Hono();
    app.get('/metrics', metricsHandler(metrics));

    const res = await app.request('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toContain('http_requests_total');
  });
});