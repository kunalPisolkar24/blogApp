import type { MiddlewareHandler } from 'hono';
import type { Logger } from './logger.js';
import type { Metrics } from './metrics.js';

const EXCLUDED_PATH = '/metrics';

export function requestLogging(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path === EXCLUDED_PATH) {
      return next();
    }
    const start = performance.now();
    await next();
    const durationMs = Math.round((performance.now() - start) * 100) / 100;
    const fields = {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs,
      requestId: c.get('requestId'),
    };
    if (c.res.status >= 500) {
      logger.error(fields, 'request completed');
    } else {
      logger.info(fields, 'request completed');
    }
  };
}

export function requestMetrics(metrics: Metrics): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path === EXCLUDED_PATH) {
      return next();
    }
    metrics.recordRequestStart();
    const start = performance.now();
    try {
      await next();
    } finally {
      metrics.recordRequestEnd();
    }
    metrics.recordRequest(
      c.req.method,
      c.req.routePath || 'unmatched',
      c.res.status,
      (performance.now() - start) / 1000,
    );
  };
}
