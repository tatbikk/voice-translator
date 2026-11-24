// Test environment: paths, the test configuration file and the guard that keeps
// every destructive helper on a database whose name ends in "_test".
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
export const REPO_ROOT = join(WEB_ROOT, '..', '..');
export const SRC_ROOT = join(WEB_ROOT, 'src');
export const TEST_ENV_FILE = join(WEB_ROOT, '.env.test');

/** Variables every integration test needs (contract §3). */
export const REQUIRED_TEST_VARIABLES = [
  'APP_MODE',
  'DEMO_TOOLS',
  'AI_EXTERNAL_ALLOWED',
  'APP_URL',
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'APP_DB_PASSWORD',
  'SESSION_SECRET',
  'SECRETS_MASTER_KEY',
  'ACCESS_CODE',
  'SEED_DEMO_PASSWORD',
] as const;

/**
 * Loads apps/web/.env.test into process.env. process.loadEnvFile never replaces
 * a variable that is already set, so CI (which sets the variables itself and has
 * no file) and local runs behave the same way.
 */
export function loadTestEnv(): void {
  if (REQUIRED_TEST_VARIABLES.every((name) => process.env[name])) return;
  if (existsSync(TEST_ENV_FILE)) process.loadEnvFile(TEST_ENV_FILE);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`test environment: ${name} is not set (apps/web/.env.test or the CI environment)`);
  }
  return value;
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/**
 * Refuses to go on unless both connections point at the same database and its
 * name ends in "_test" (contract §10: integration-test setup works on
 * mahkama_test only).
 */
export function assertTestDatabase(): void {
  const owner = databaseName(requireEnv('MIGRATION_DATABASE_URL'));
  const runtime = databaseName(requireEnv('DATABASE_URL'));
  if (!owner.endsWith('_test')) {
    throw new Error(`refusing to run: MIGRATION_DATABASE_URL names "${owner}", which does not end in "_test"`);
  }
  if (runtime !== owner) {
    throw new Error(`refusing to run: DATABASE_URL names "${runtime}" but MIGRATION_DATABASE_URL names "${owner}"`);
  }
}

export function appUrl(): string {
  return requireEnv('APP_URL').replace(/\/$/, '');
}

export function appOrigin(): string {
  return new URL(appUrl()).origin;
}

export function idleMinutes(): number {
  const raw = process.env.SESSION_IDLE_MINUTES;
  const value = raw === undefined || raw === '' ? 30 : Number(raw);
  return Number.isInteger(value) ? Math.min(60, Math.max(5, value)) : 30;
}

/**
 * Asks the application to forget a cached configuration after a test changed
 * process.env (for example a new ACCESS_CODE). Uses resetEnvCache() when the
 * configuration module exports it; otherwise the module is expected to notice
 * the change by itself.
 */
export async function forgetCachedConfiguration(): Promise<void> {
  let mod: { resetEnvCache?: unknown };
  try {
    mod = await import('@/server/config/env');
  } catch {
    return;
  }
  const reset = mod.resetEnvCache;
  if (typeof reset === 'function') Reflect.apply(reset, undefined, []);
}

/** Sets (or, with undefined, removes) variables, and returns a function that restores them. */
export async function overrideEnv(overrides: Record<string, string | undefined>): Promise<() => Promise<void>> {
  const previous: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(overrides)) {
    previous[name] = process.env[name];
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
  await forgetCachedConfiguration();
  return async () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
    await forgetCachedConfiguration();
  };
}

export async function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const restore = await overrideEnv(overrides);
  try {
    return await fn();
  } finally {
    await restore();
  }
}
