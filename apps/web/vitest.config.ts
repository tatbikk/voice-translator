import { defineConfig } from 'vitest/config';
import { alias } from './vitest.shared.ts';

// Unit tests: no database, no network.
export default defineConfig({
  resolve: { alias },
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
