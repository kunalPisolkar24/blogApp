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
  },
});