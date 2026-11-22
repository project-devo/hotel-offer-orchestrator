import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    // Integration suites share one Redis database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SUPPLIER_LATENCY_MS: '0',
    },
  },
});
