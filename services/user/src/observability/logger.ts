import { trace } from '@opentelemetry/api';
import { pino, type DestinationStream, type Logger as PinoLogger } from 'pino';
import { env } from '../config/env.js';

export type Logger = PinoLogger;

function traceIds(): { trace_id?: string; span_id?: string } {
  const span = trace.getActiveSpan();
  if (!span) {
    return {};
  }
  const context = span.spanContext();
  return {
    trace_id: context.traceId,
    span_id: context.spanId,
  };
}

export function createLogger(stream?: DestinationStream): Logger {
  return pino(
    {
      level: env.LOG_LEVEL,
      base: { service: 'user-service' },
      timestamp: pino.stdTimeFunctions.isoTime,
      mixin: traceIds,
      redact: {
        paths: ['password', '*.password', 'token', '*.token'],
        censor: '[redacted]',
      },
    },
    stream,
  );
}

export const logger = createLogger();
