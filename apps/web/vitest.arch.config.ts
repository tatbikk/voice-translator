import { defineConfig } from 'vitest/config';
import { alias } from './vitest.shared';

// Architecture tests: static checks over the source tree.
export default defineConfig({
  resolve: { alias },
  test: {
    include: ['tests/architecture/**/*.test.ts'],
    environment: 'node',
  },
});
