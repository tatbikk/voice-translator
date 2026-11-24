// Bundles the worker and the command-line tools into dist-server/*.mjs.
// ESM output (the generated Prisma client uses import.meta.url), every package
// kept external (pg uses dynamic require; @node-rs/argon2 is a native addon),
// and "server-only" replaced by a shim because these entry points run in plain
// Node, not inside Next.js.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const entryPoints = {
  worker: 'src/worker/main.ts',
  seed: 'src/cli/seed.ts',
  'verify-events': 'src/cli/verify-events.ts',
  'boot-check': 'src/cli/boot-check.ts',
  'db-roles': 'src/cli/db-roles.ts',
};

await build({
  absWorkingDir: root,
  entryPoints,
  outdir: 'dist-server',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  alias: {
    'server-only': './src/server/shims/server-only.ts',
    '@': './src',
  },
  sourcemap: true,
  logLevel: 'warning',
  legalComments: 'none',
});
