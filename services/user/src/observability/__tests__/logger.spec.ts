import { Writable } from 'node:stream';
import { context, trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../logger.js';

const mocks = vi.hoisted(() => ({
  env: { LOG_LEVEL: 'info' },
}));

vi.mock('../../config/env.js', () => ({ env: mocks.env }));

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

function capture(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { stream, lines };
}

describe('createLogger', () => {
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
  });

  beforeAll(() => {
    provider.register();
  });

  afterAll(async () => {
    await provider.shutdown();
  });
  it('emits JSON logs with the service name and level', async () => {
    const { stream, lines } = capture();
    const log = createLogger(stream);

    log.info({ foo: 'bar' }, 'hello');
    await flush();

    const entry = JSON.parse(lines[0]!);
    expect(entry.service).toBe('user-service');
    expect(entry.level).toBe(30);
    expect(entry.msg).toBe('hello');
    expect(entry.foo).toBe('bar');
  });

  it('redacts passwords and tokens', async () => {
    const { stream, lines } = capture();
    const log = createLogger(stream);

    log.info({ password: 's3cret', user: { token: 'abc123' } }, 'auth');
    await flush();

    const entry = JSON.parse(lines[0]!);
    expect(entry.password).toBe('[redacted]');
    expect(entry.user.token).toBe('[redacted]');
  });

  it('omits trace fields when no span is active', async () => {
    const { stream, lines } = capture();
    const log = createLogger(stream);

    log.info('outside span');
    await flush();

    const entry = JSON.parse(lines[0]!);
    expect(entry.trace_id).toBeUndefined();
    expect(entry.span_id).toBeUndefined();
  });

  it('adds trace and span ids when a span is active', async () => {
    const { stream, lines } = capture();
    const log = createLogger(stream);

    const span = trace.getTracer('test').startSpan('test');
    context.with(trace.setSpan(context.active(), span), () => {
      log.info('inside span');
    });
    span.end();
    await flush();

    const entry = JSON.parse(lines[0]!);
    expect(entry.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(entry.span_id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('serializes errors with a stack trace', async () => {
    const { stream, lines } = capture();
    const log = createLogger(stream);

    log.error(new Error('boom'));
    await flush();

    const entry = JSON.parse(lines[0]!);
    expect(entry.level).toBe(50);
    expect(entry.err?.message).toBe('boom');
    expect(entry.err?.stack).toContain('Error: boom');
  });
});