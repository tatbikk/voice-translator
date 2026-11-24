// Bundles the worker and the command-line tools into dist-server/*.mjs, and
// writes the build marker dist-server/build-info.json ({ "demoBuild": … },
// from DEMO_BUILD, like next.config.ts), which every process reads at boot
// (src/server/boot/build-info.ts, review A-15).
// ESM output (the generated Prisma client uses import.meta.url), installed
// packages kept external (pg uses dynamic require; @node-rs/argon2 is a native
// addon), the workspace core bundled, and "server-only" replaced by a shim because these entry points run in plain
// Node, not inside Next.js.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// Every installed package stays external, except the workspace core package,
// which is TypeScript source and must be bundled.
const manifests = ['../package.json', '../../../package.json'].map((p) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')),
);
const external = [
  ...new Set(
    manifests.flatMap((m) => [...Object.keys(m.dependencies ?? {}), ...Object.keys(m.devDependencies ?? {})]),
  ),
]
  .filter((name) => name !== '@mahkama/core')
  .flatMap((name) => [name, `${name}/*`]);

const entryPoints = {
  worker: 'src/worker/main.ts',
  seed: 'src/cli/seed.ts',
  'verify-events': 'src/cli/verify-events.ts',
  'boot-check': 'src/cli/boot-check.ts',
  'db-roles': 'src/cli/db-roles.ts',
  release: 'src/cli/release.ts',
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
  external,
  alias: {
    'server-only': './src/server/shims/server-only.ts',
    '@': './src',
  },
  sourcemap: true,
  logLevel: 'warning',
  legalComments: 'none',
});

const outdir = fileURLToPath(new URL('../dist-server/', import.meta.url));
mkdirSync(outdir, { recursive: true });
writeFileSync(`${outdir}build-info.json`, `${JSON.stringify({ demoBuild: process.env.DEMO_BUILD === 'true' })}\n`);
