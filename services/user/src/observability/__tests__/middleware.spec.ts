import { Writable } from 'node:stream';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { afterEach, describe, expect, it, vi } from 'vitest';
import client from 'prom-client';
import { createLogger, type Logger } from '../logger.js';
import { requestLogging, requestMetrics } from '../middleware.js';
import { Metrics } from '../metrics.js';

const mocks = vi.hoisted(() => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'info' },
}));

vi.mock('../../config/env.js', () => ({ env: mocks.env }));

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

function captureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { logger: createLogger(stream), lines };
}

describe('request observability middleware', () => {
  afterEach(() => {
    client.register.clear();
  });

  it('logs completed requests with a request id', async () => {
    const { logger, lines } = captureLogger();
    const metrics = new Metrics();
    const app = new Hono();
    app.use(requestId());
    app.use(requestLogging(logger), requestMetrics(metrics));
    app.get('/ping', (c) => c.text('pong'));

    await app.request('/ping');
    await flush();

    const entry = JSON.parse(lines[0]!);
    expect(entry.msg).toBe('request completed');
    expect(entry.method).toBe('GET');
    expect(entry.path).toBe('/ping');
    expect(entry.status).toBe(200);
    expect(entry.requestId).toBeTypeOf('string');
  });

  it('records request metrics with the matched route', async () => {
    const { logger } = captureLogger();
    const metrics = new Metrics();
    const app = new Hono();
    app.use(requestLogging(logger), requestMetrics(metrics));
    app.get('/users/:id', (c) => c.text(c.req.param('id')));

    await app.request('/users/u1');

    const output = await metrics.getMetrics();
    expect(output).toContain('http_requests_total{method="GET",route="/users/:id",status="200"} 1');
  });

  it('logs server errors at error level', async () => {
    const { logger, lines } = captureLogger();
    const metrics = new Metrics();
    const app = new Hono();
    app.use(requestId());
    app.use(requestLogging(logger), requestMetrics(metrics));
    app.onError((error, c) => c.json({ error: String(error) }, 500));
    app.get('/boom', () => {
      throw new Error('boom');
    });

    await app.request('/boom');
    await flush();

    const entry = JSON.parse(lines[0]!);
    expect(entry.level).toBe(50);
    expect(entry.status).toBe(500);
  });

  it('skips logging and metrics for the metrics endpoint', async () => {
    const { logger, lines } = captureLogger();
    const metrics = new Metrics();
    const app = new Hono();
    app.use(requestLogging(logger), requestMetrics(metrics));
    app.get('/metrics', (c) => c.text('metrics'));

    await app.request('/metrics');
    await flush();

    expect(lines).toHaveLength(0);
    const output = await metrics.getMetrics();
    expect(output).not.toContain('route="/metrics"');
  });
});
