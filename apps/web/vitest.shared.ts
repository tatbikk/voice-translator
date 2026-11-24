import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('./src', import.meta.url));

// Aliases shared by every Vitest configuration of the web app.
export const alias = {
  '@/': `${src}/`,
  'server-only': fileURLToPath(new URL('./src/server/shims/server-only.ts', import.meta.url)),
};
