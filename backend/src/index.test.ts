import app from '../src/index';
import { describe, it, expect, vi } from 'vitest';

interface PingResponseBody {
  status: string;
  message: string;
  timestamp: string;
}


const mockEnv = {
  DATABASE_URL: 'mock_database_url',
  JWT_SECRET: 'mock_jwt_secret',
  DATABASE_URL_MIGRATE: 'mock_database_url_migrate',
  UPSTASH_REDIS_REST_URL: 'mock_upstash_redis_rest_url',
  UPSTASH_REDIS_REST_TOKEN: 'mock_upstash_redis_rest_token', 
  RAILWAY_CONSUMER_WAKEUP_URL: 'mock_railway_consumer_wakeup_url',
  RAILWAY_WAKEUP_SECRET: 'mock_railway_wakeup_secret',
  UPSTASH_RATELIMIT_REDIS_REST_URL: 'MOCK_UPSTASH_RATELIMIT_REDIS_REST_URL',
  UPSTASH_RATELIMIT_REDIS_REST_TOKEN: 'MOCK_UPSTASH_RATELIMIT_REDIS_REST_TOKEN',
};

vi.mock('@upstash/redis/cloudflare', () => {
  const Redis = vi.fn(() => ({
    incr: vi.fn().mockResolvedValue(1),
    pexpire: vi.fn().mockResolvedValue(1),
  }));
  return { Redis };
});


describe('Hono App (index.ts)', () => {
  describe('GET /ping endpoint', () => {
    it('should return 200 OK with status, message, and timestamp', async () => {
      const request = new Request('http://localhost/ping', {
        method: 'GET',
      });
      const response = await app.fetch(request, mockEnv);

      expect(response.status).toBe(200);

      const body = await response.json() as PingResponseBody;

      expect(body.status).toBe('ok');
      expect(body.message).toBe('API Routes are working!');
      expect(body).toHaveProperty('timestamp');
      expect(typeof body.timestamp).toBe('string');

      const parsedDate = new Date(body.timestamp);
      expect(parsedDate.toISOString()).toBe(body.timestamp);
      expect(Date.now() - parsedDate.getTime()).toBeLessThanOrEqual(15000);
    });

    it('should include CORS headers in the response for GET /ping', async () => {
      const request = new Request('http://localhost/ping', {
        method: 'GET',
      });
      const response = await app.fetch(request, mockEnv);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('CORS Preflight (OPTIONS) requests', () => {
    it('should respond to OPTIONS request for /ping with appropriate CORS headers', async () => {
      const request = new Request('http://localhost/ping', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      });

      const response = await app.fetch(request, mockEnv);

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

      const allowedMethods = response.headers.get('Access-Control-Allow-Methods');
      expect(allowedMethods).toContain('GET');
      expect(allowedMethods).toContain('POST');

      const allowedHeaders = response.headers.get('Access-Control-Allow-Headers');
      expect(allowedHeaders).toContain('Content-Type');
      expect(allowedHeaders).toContain('Authorization');
    });
  });
});