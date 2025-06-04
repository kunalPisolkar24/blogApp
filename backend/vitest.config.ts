import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          vars: {
            UPSTASH_RATELIMIT_REDIS_REST_URL: "mock_redis_url",
            UPSTASH_RATELIMIT_REDIS_REST_TOKEN: "mock_redis_token",
          }
        }
      },
    },
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/',
        'test/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        'wrangler.toml',
      ],
      reportOnFailure: true,
    },
  },
});