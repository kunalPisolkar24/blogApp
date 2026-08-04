import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export function setupTracing(): void {
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    logger.info('tracing disabled: OTEL_EXPORTER_OTLP_ENDPOINT not set');
    return;
  }

  const exporter = new OTLPTraceExporter({
    url: new URL('/v1/traces', env.OTEL_EXPORTER_OTLP_ENDPOINT).toString(),
  });

  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME,
    spanProcessors: [new BatchSpanProcessor(exporter)],
    instrumentations: [new HttpInstrumentation(), new IORedisInstrumentation()],
  });

  sdk.start();
  logger.info('tracing enabled: exporting to %s', env.OTEL_EXPORTER_OTLP_ENDPOINT);
}
