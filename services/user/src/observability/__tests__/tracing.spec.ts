import { trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupTracing } from '../tracing.js';

const mocks = vi.hoisted(() => ({
  env: {
    OTEL_EXPORTER_OTLP_ENDPOINT: '',
    OTEL_SERVICE_NAME: 'user-service',
  },
  logger: {
    info: vi.fn(),
  },
}));

vi.mock('../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../logger.js', () => ({ logger: mocks.logger }));

describe('setupTracing', () => {
  afterEach(() => {
    mocks.logger.info.mockClear();
    mocks.env.OTEL_EXPORTER_OTLP_ENDPOINT = '';
    trace.disable();
  });

  it('does nothing when no endpoint is configured', () => {
    setupTracing();

    expect(mocks.logger.info).toHaveBeenCalledWith(
      'tracing disabled: OTEL_EXPORTER_OTLP_ENDPOINT not set',
    );
  });

  it('starts the SDK and exports to the configured endpoint', () => {
    mocks.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';

    setupTracing();

    expect(mocks.logger.info).toHaveBeenCalledWith(
      'tracing enabled: exporting to %s',
      'http://collector:4318',
    );
  });
});
