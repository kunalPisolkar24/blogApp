import { afterEach, describe, expect, it, vi } from 'vitest';
import client from 'prom-client';
import { EventEmitter } from 'node:events';
import { Metrics, extractErrorCodes } from '../metrics.js';
import type { Pool } from 'pg';

const mocks = vi.hoisted(() => ({
  env: { NODE_ENV: 'test' },
}));

vi.mock('../../config/env.js', () => ({ env: mocks.env }));

function fakePool(stats: { total: number; idle: number; waiting: number }): Pool {
  return { totalCount: stats.total, idleCount: stats.idle, waitingCount: stats.waiting } as Pool;
}

describe('Metrics', () => {
  afterEach(() => {
    client.register.clear();
    mocks.env.NODE_ENV = 'test';
  });

  it('records http requests with method, route, and status labels', async () => {
    const metrics = new Metrics();
    metrics.recordRequest('POST', '/graphql', 200, 0.05);
    metrics.recordRequest('GET', '/health', 200, 0.01);

    const output = await metrics.getMetrics();
    expect(output).toContain('http_requests_total{method="GET",route="/health",status="200"} 1');
    expect(output).toContain('http_requests_total{method="POST",route="/graphql",status="200"} 1');
    expect(output).toContain('http_request_duration_seconds_bucket');
  });

  it('records graphql operations with status labels', async () => {
    const metrics = new Metrics();
    metrics.recordGraphqlOperation('signup', 'success', 0.1);
    metrics.recordGraphqlOperation('signin', 'error', 0.05);

    const output = await metrics.getMetrics();
    expect(output).toContain('graphql_operations_total{operation="signup",status="success"} 1');
    expect(output).toContain('graphql_operations_total{operation="signin",status="error"} 1');
    expect(output).toContain('graphql_operation_duration_seconds_bucket');
  });

  it('records cache reads and invalidations', async () => {
    const metrics = new Metrics();
    metrics.recordCacheRead('hit');
    metrics.recordCacheRead('miss');
    metrics.recordCacheRead('read_error');
    metrics.recordCacheRead('write_error');
    metrics.recordCacheInvalidation('key', 'ok');
    metrics.recordCacheInvalidation('lists', 'error');

    const output = await metrics.getMetrics();
    expect(output).toContain('cache_operations_total{operation="read",result="hit"} 1');
    expect(output).toContain('cache_operations_total{operation="read",result="miss"} 1');
    expect(output).toContain('cache_operations_total{operation="read",result="read_error"} 1');
    expect(output).toContain('cache_operations_total{operation="read",result="write_error"} 1');
    expect(output).toContain('cache_invalidations_total{operation="key",result="ok"} 1');
    expect(output).toContain('cache_invalidations_total{operation="lists",result="error"} 1');
  });

  it('records db query durations', async () => {
    const metrics = new Metrics();
    metrics.recordDbQuery('findById', 'success', 0.02);
    metrics.recordDbQuery('create', 'error', 0.01);

    const output = await metrics.getMetrics();
    expect(output).toContain('db_query_duration_seconds_bucket');
  });

  it('records auth events', async () => {
    const metrics = new Metrics();
    metrics.recordSignup();
    metrics.recordSignin();
    metrics.recordSigninFailure();

    const output = await metrics.getMetrics();
    expect(output).toContain('user_signups_total 1');
    expect(output).toContain('user_signins_total 1');
    expect(output).toContain('user_signin_failures_total 1');
  });

  it('tracks in-flight requests with the start/end gauge', async () => {
    const metrics = new Metrics();
    metrics.recordRequestStart();
    metrics.recordRequestStart();
    metrics.recordRequestEnd();

    const output = await metrics.getMetrics();
    expect(output).toContain('http_requests_in_flight 1');
  });

  it('records graphql errors by operation and code', async () => {
    const metrics = new Metrics();
    metrics.recordGraphqlError('signin', 'INVALID_CREDENTIALS');
    metrics.recordGraphqlError('signin', 'INVALID_CREDENTIALS');
    metrics.recordGraphqlError('users', 'VALIDATION_ERROR');

    const output = await metrics.getMetrics();
    expect(output).toContain(
      'graphql_errors_total{operation="signin",code="INVALID_CREDENTIALS"} 2',
    );
    expect(output).toContain(
      'graphql_errors_total{operation="users",code="VALIDATION_ERROR"} 1',
    );
  });

  it('exposes db pool connections from registered pools on scrape', async () => {
    const metrics = new Metrics();
    metrics.registerDbPools([
      { node: 'primary', pool: fakePool({ total: 5, idle: 3, waiting: 1 }) },
      { node: 'replica', pool: fakePool({ total: 2, idle: 2, waiting: 0 }) },
    ]);

    const output = await metrics.getMetrics();
    expect(output).toContain('db_pool_connections{node="primary",state="total"} 5');
    expect(output).toContain('db_pool_connections{node="primary",state="idle"} 3');
    expect(output).toContain('db_pool_connections{node="primary",state="waiting"} 1');
    expect(output).toContain('db_pool_connections{node="replica",state="total"} 2');
  });

  it('tracks redis connectivity from client events', async () => {
    const redis = new EventEmitter() as unknown as import('ioredis').Redis;
    const metrics = new Metrics();
    metrics.registerRedis(redis);

    const before = await metrics.getMetrics();
    expect(before).toContain('redis_connected 0');

    redis.emit('ready');
    const ready = await metrics.getMetrics();
    expect(ready).toContain('redis_connected 1');

    redis.emit('close');
    const closed = await metrics.getMetrics();
    expect(closed).toContain('redis_connected 0');
  });

  it('reports redis as disconnected when none is configured', async () => {
    const metrics = new Metrics();
    metrics.registerRedis(null);

    const output = await metrics.getMetrics();
    expect(output).toContain('redis_connected 0');
  });

  it('collects default node metrics outside tests', async () => {
    mocks.env.NODE_ENV = 'production';
    const metrics = new Metrics();

    const output = await metrics.getMetrics();
    expect(output).toContain('process_cpu_seconds_total');
  });

  it('exposes the prometheus content type', () => {
    const metrics = new Metrics();
    expect(metrics.getContentType()).toContain('text/plain');
  });
});

describe('extractErrorCodes', () => {
  it('extracts extension codes from graphql error bodies', () => {
    const body = JSON.stringify({
      errors: [
        { extensions: { code: 'INVALID_CREDENTIALS' } },
        { extensions: { code: 'VALIDATION_ERROR' } },
        { message: 'no code' },
      ],
    });

    expect(extractErrorCodes(body)).toEqual([
      'INVALID_CREDENTIALS',
      'VALIDATION_ERROR',
      'UNKNOWN',
    ]);
  });

  it('returns an empty list for success or invalid bodies', () => {
    expect(extractErrorCodes('{"data":{}}')).toEqual([]);
    expect(extractErrorCodes('not-json')).toEqual([]);
  });
});
