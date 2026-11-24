// Runs the bundled command-line tools (dist-server/*.mjs) and the Prisma CLI as
// separate processes, the way CI and the Railway pre-deploy step run them.
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT, WEB_ROOT } from './env';

export interface ProcessResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** stdout and stderr together, for assertions on logged codes */
  readonly output: string;
}

export function runProcess(
  command: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {},
): ProcessResult {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd ?? WEB_ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const stdout = result.stdout;
  const stderr = result.stderr;
  return { status: result.status, stdout, stderr, output: `${stdout}\n${stderr}` };
}

/**
 * The environment of a web or worker process: without the owner's connection and
 * the seed password, which only the release step holds (review A-01).
 */
export function runtimeOnly(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...env };
  for (const name of ['MIGRATION_DATABASE_URL', 'APP_DB_PASSWORD', 'SEED_DEMO_PASSWORD']) Reflect.deleteProperty(copy, name);
  return copy;
}

/** `node dist-server/<name>.mjs …` from apps/web. */
export function runBundled(
  name: 'boot-check' | 'seed' | 'verify-events' | 'db-roles' | 'worker',
  args: readonly string[] = [],
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 120_000,
): ProcessResult {
  return runProcess(process.execPath, [join('dist-server', `${name}.mjs`), ...args], { env, timeoutMs });
}

export function expectSuccess(what: string, result: ProcessResult): void {
  if (result.status !== 0) {
    throw new Error(`${what} exited with ${String(result.status)}\n${result.output.slice(-4000)}`);
  }
}

/** Bundles the worker and the command-line tools (scripts/bundle.mjs). */
export function bundleServer(): void {
  expectSuccess('scripts/bundle.mjs', runProcess(process.execPath, ['scripts/bundle.mjs']));
}

/** `prisma migrate deploy` with the owner connection of the current environment. */
export function migrateDeploy(env: NodeJS.ProcessEnv = process.env): void {
  const prisma = join(REPO_ROOT, 'node_modules', 'prisma', 'build', 'index.js');
  expectSuccess('prisma migrate deploy', runProcess(process.execPath, [prisma, 'migrate', 'deploy'], { env }));
}

/** The role-provisioning step (src/cli/db-roles.ts), run after every migrate deploy. */
export function provisionRoles(env: NodeJS.ProcessEnv = process.env): void {
  expectSuccess('dist-server/db-roles.mjs', runBundled('db-roles', [], env));
}

export interface RunningProcess {
  output(): string;
  stop(): Promise<number | null>;
}

/** Starts the bundled worker (dist-server/worker.mjs) in the background, as `npm run worker` does. */
export function startWorker(env: NodeJS.ProcessEnv = process.env): RunningProcess {
  const child = spawn(process.execPath, [join('dist-server', 'worker.mjs')], {
    cwd: WEB_ROOT,
    env: runtimeOnly(env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chunks: string[] = [];
  child.stdout.on('data', (d: Buffer) => chunks.push(d.toString('utf8')));
  child.stderr.on('data', (d: Buffer) => chunks.push(d.toString('utf8')));
  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => {
      resolve(code);
    });
  });
  return {
    output: () => chunks.join(''),
    stop: async () => {
      if (child.exitCode === null) child.kill('SIGTERM');
      const timeout = new Promise<null>((resolve) => setTimeout(() => {
        child.kill('SIGKILL');
        resolve(null);
      }, 10_000));
      return Promise.race([exited, timeout]);
    },
  };
}
