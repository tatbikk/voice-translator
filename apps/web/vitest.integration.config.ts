import { defineConfig } from 'vitest/config';
import { alias } from './vitest.shared.ts';

// Integration tests against the PostgreSQL test database (mahkama_test).
// The global setup recreates the schema; tests share one database, so files run
// one after the other.
export default defineConfig({
  resolve: { alias },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/helpers/global-setup.ts'],
    setupFiles: ['tests/helpers/integration-env.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
