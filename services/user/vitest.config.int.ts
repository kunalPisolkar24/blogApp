import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/integration/**/*.int.spec.ts'],
    exclude: ['node_modules/', 'dist/'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    globalSetup: ['./src/integration/helpers/global-setup.ts'],
    pool: 'forks',
    singleFork: true,
  },
});