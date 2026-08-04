import { afterEach, describe, expect, it, vi } from 'vitest';
import client from 'prom-client';
import { Metrics } from '../observability/metrics.js';

const mocks = vi.hoisted(() => ({
  env: { NODE_ENV: 'test' },
}));

vi.mock('../config/env.js', () => ({ env: mocks.env }));

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
