import client from 'prom-client';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { env } from '../config/env.js';

export type CacheReadResult = 'hit' | 'miss' | 'read_error' | 'write_error';
export type CacheInvalidationResult = 'ok' | 'error';
export type DbQueryStatus = 'success' | 'error';

const HTTP_DURATION_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

export interface DbPoolRegistration {
  node: 'primary' | 'replica';
  pool: Pool;
}

export function extractErrorCodes(body: string): string[] {
  try {
    const parsed = JSON.parse(body) as { errors?: Array<{ extensions?: { code?: string } }> };
    if (!Array.isArray(parsed.errors)) {
      return [];
    }
    return parsed.errors.map((error) => error?.extensions?.code ?? 'UNKNOWN');
  } catch {
    return [];
  }
}

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

  private readonly httpInFlight = new client.Gauge({
    name: 'http_requests_in_flight',
    help: 'Number of HTTP requests currently being processed',
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

  private readonly graphqlErrors = new client.Counter({
    name: 'graphql_errors_total',
    help: 'Total number of GraphQL errors by operation and error code',
    labelNames: ['operation', 'code'],
  });

  private readonly dbPools: DbPoolRegistration[] = [];

  private readonly dbPoolConnections = new client.Gauge({
    name: 'db_pool_connections',
    help: 'Postgres pool connections by node and state',
    labelNames: ['node', 'state'],
    collect: () => {
      for (const { node, pool } of this.dbPools) {
        this.dbPoolConnections.set({ node, state: 'total' }, pool.totalCount);
        this.dbPoolConnections.set({ node, state: 'idle' }, pool.idleCount);
        this.dbPoolConnections.set({ node, state: 'waiting' }, pool.waitingCount);
      }
    },
  });

  private readonly redisConnected = new client.Gauge({
    name: 'redis_connected',
    help: '1 when Redis is connected, 0 otherwise',
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

  recordRequestStart(): void {
    this.httpInFlight.inc();
  }

  recordRequestEnd(): void {
    this.httpInFlight.dec();
  }

  recordGraphqlOperation(
    operation: string,
    status: 'success' | 'error',
    durationSeconds: number,
  ): void {
    this.graphqlOperations.inc({ operation, status });
    this.graphqlDuration.observe({ operation, status }, durationSeconds);
  }

  recordGraphqlError(operation: string, code: string): void {
    this.graphqlErrors.inc({ operation, code });
  }

  registerDbPools(pools: DbPoolRegistration[]): void {
    this.dbPools.push(...pools);
  }

  registerRedis(redis: Redis | null): void {
    if (!redis) {
      this.redisConnected.set(0);
      return;
    }
    redis.on('ready', () => this.redisConnected.set(1));
    redis.on('close', () => this.redisConnected.set(0));
    redis.on('end', () => this.redisConnected.set(0));
    redis.on('error', () => this.redisConnected.set(0));
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
