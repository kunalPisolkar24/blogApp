import client from 'prom-client';
import { env } from '../config/env.js';

export type CacheReadResult = 'hit' | 'miss' | 'read_error' | 'write_error';
export type CacheInvalidationResult = 'ok' | 'error';
export type DbQueryStatus = 'success' | 'error';

const HTTP_DURATION_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

export class Metrics {
  private readonly httpRequests = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status'],
  });

  private readonly httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency',
    labelNames: ['method', 'route', 'status'],
    buckets: HTTP_DURATION_BUCKETS,
  });

  private readonly graphqlOperations = new client.Counter({
    name: 'graphql_operations_total',
    help: 'Total number of GraphQL operations',
    labelNames: ['operation', 'status'],
  });

  private readonly graphqlDuration = new client.Histogram({
    name: 'graphql_operation_duration_seconds',
    help: 'GraphQL operation latency',
    labelNames: ['operation', 'status'],
    buckets: HTTP_DURATION_BUCKETS,
  });

  private readonly cacheReads = new client.Counter({
    name: 'cache_operations_total',
    help: 'Total number of cache read operations',
    labelNames: ['operation', 'result'],
  });

  private readonly cacheInvalidations = new client.Counter({
    name: 'cache_invalidations_total',
    help: 'Total number of cache invalidation operations',
    labelNames: ['operation', 'result'],
  });

  private readonly dbQueries = new client.Histogram({
    name: 'db_query_duration_seconds',
    help: 'Database query latency',
    labelNames: ['operation', 'status'],
    buckets: HTTP_DURATION_BUCKETS,
  });

  private readonly signups = new client.Counter({
    name: 'user_signups_total',
    help: 'Total number of successful signups',
  });

  private readonly signins = new client.Counter({
    name: 'user_signins_total',
    help: 'Total number of successful signins',
  });

  private readonly signinFailures = new client.Counter({
    name: 'user_signin_failures_total',
    help: 'Total number of failed signin attempts',
  });

  constructor() {
    if (env.NODE_ENV !== 'test') {
      client.collectDefaultMetrics();
    }
  }

  recordRequest(method: string, route: string, status: number, durationSeconds: number): void {
    this.httpRequests.inc({ method, route, status });
    this.httpDuration.observe({ method, route, status }, durationSeconds);
  }

  recordGraphqlOperation(
    operation: string,
    status: 'success' | 'error',
    durationSeconds: number,
  ): void {
    this.graphqlOperations.inc({ operation, status });
    this.graphqlDuration.observe({ operation, status }, durationSeconds);
  }

  recordCacheRead(result: CacheReadResult): void {
    this.cacheReads.inc({ operation: 'read', result });
  }

  recordCacheInvalidation(operation: 'key' | 'lists', result: CacheInvalidationResult): void {
    this.cacheInvalidations.inc({ operation, result });
  }

  recordDbQuery(operation: string, status: DbQueryStatus, durationSeconds: number): void {
    this.dbQueries.observe({ operation, status }, durationSeconds);
  }

  recordSignup(): void {
    this.signups.inc();
  }

  recordSignin(): void {
    this.signins.inc();
  }

  recordSigninFailure(): void {
    this.signinFailures.inc();
  }

  getContentType(): string {
    return client.register.contentType;
  }

  async getMetrics(): Promise<string> {
    return client.register.metrics();
  }
}
