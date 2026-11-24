// Starts the application for the end-to-end suite (playwright.config.ts webServer).
//
//   1. configuration from apps/web/.env.e2e (or the CI environment); the database
//      name must end in "_e2e", so this script can never touch another database;
//   2. a demo build (DEMO_BUILD=true), unless E2E_SKIP_BUILD=true (CI builds first);
//   3. a fresh demo database: seed --reset --confirm=<name> (migrations, runtime
//      role, demo stamp, demo data);
//   4. `next start` on port 3100, stopped with the Playwright run.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const envFile = join(webRoot, '.env.e2e');
const required = ['APP_URL', 'DATABASE_URL', 'MIGRATION_DATABASE_URL', 'APP_DB_PASSWORD', 'SESSION_SECRET', 'SECRETS_MASTER_KEY', 'ACCESS_CODE', 'SEED_DEMO_PASSWORD'];
if (!required.every((name) => process.env[name]) && existsSync(envFile)) process.loadEnvFile(envFile);
for (const name of required) {
  if (!process.env[name]) {
    console.error(`e2e-server: ${name} is not set (apps/web/.env.e2e or the CI environment)`);
    process.exit(1);
  }
}

const database = (url) => decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
const name = database(process.env.MIGRATION_DATABASE_URL);
if (!name.endsWith('_e2e') || database(process.env.DATABASE_URL) !== name) {
  console.error(`e2e-server: refusing database "${name}" (the name must end in "_e2e", same database for both roles)`);
  process.exit(1);
}

const env = {
  ...process.env,
  APP_MODE: 'demo',
  DEMO_TOOLS: 'true',
  DEMO_BUILD: 'true',
  AI_EXTERNAL_ALLOWED: 'false',
  NODE_ENV: 'production',
  PORT: '3100',
};

function step(command, args) {
  const result = spawnSync(command, args, { cwd: webRoot, stdio: 'inherit', env });
  if (result.status !== 0) {
    console.error(`e2e-server: step failed: ${[command, ...args].join(' ')}`);
    process.exit(1);
  }
}

if (process.env.E2E_SKIP_BUILD !== 'true') step('npm', ['run', 'build']);
step(process.execPath, [join(webRoot, 'dist-server', 'seed.mjs'), '--reset', `--confirm=${name}`]);

// The web process never receives the owner's connection or the seed password.
const runtimeEnv = { ...env };
for (const name of ['MIGRATION_DATABASE_URL', 'APP_DB_PASSWORD', 'SEED_DEMO_PASSWORD']) delete runtimeEnv[name];
const next = join(dirname(createRequire(import.meta.url).resolve('next/package.json')), 'dist', 'bin', 'next');
const server = spawn(process.execPath, [next, 'start', '-p', '3100'], { cwd: webRoot, stdio: 'inherit', env: runtimeEnv });
const stop = (signal) => {
  server.kill(signal);
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
server.on('exit', (code) => process.exit(code ?? 0));
