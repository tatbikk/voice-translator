import 'server-only';
import { z } from 'zod';
import { MASTER_KEY_BYTES, MIN_ACCESS_CODE_LENGTH, MIN_SESSION_SECRET_BYTES, clampIdleMinutes } from '@mahkama/core';

// Configuration is validated lazily on first use and cached: nothing reads
// process.env at module load, so `next build` and `prisma generate` run with an
// empty environment. Missing or invalid variables are reported by NAME only.

const bool = z.enum(['true', 'false']);
const base64Bytes = (min: number, exact?: number) =>
  z.string().refine((value) => {
    const bytes = Buffer.from(value, 'base64');
    if (bytes.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) return false;
    return exact === undefined ? bytes.length >= min : bytes.length === exact;
  }, 'invalid base64 length');

const schema = z
  .object({
    APP_MODE: z.enum(['demo', 'production']),
    DEMO_TOOLS: bool,
    AI_EXTERNAL_ALLOWED: bool,
    APP_URL: z.url(),
    DATABASE_URL: z.string().min(1),
    SESSION_SECRET: base64Bytes(MIN_SESSION_SECRET_BYTES),
    SECRETS_MASTER_KEY: base64Bytes(MASTER_KEY_BYTES, MASTER_KEY_BYTES),
    ACCESS_CODE: z.string().max(256).optional(),
    SEED_DEMO_PASSWORD: z.string().optional(),
    SESSION_IDLE_MINUTES: z.string().regex(/^\d{1,3}$/).optional(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  })
  .superRefine((env, ctx) => {
    const url = new URL(env.APP_URL);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
      ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'https required' });
    }
    if (url.pathname !== '/' || url.search || url.hash) {
      ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'origin only' });
    }
    if (env.APP_MODE === 'demo' && (env.ACCESS_CODE ?? '').length < MIN_ACCESS_CODE_LENGTH) {
      ctx.addIssue({ code: 'custom', path: ['ACCESS_CODE'], message: 'too short' });
    }
  });

export interface AppEnv {
  readonly mode: 'demo' | 'production';
  /** raw value of DEMO_TOOLS, for the boot check */
  readonly demoToolsRaw: 'true' | 'false';
  /** demo tools are on only in demo mode */
  readonly demoToolsEnabled: boolean;
  readonly aiExternalAllowed: boolean;
  readonly appUrl: string;
  readonly appOrigin: string;
  readonly databaseUrl: string;
  readonly sessionSecret: Buffer;
  readonly masterKey: Buffer;
  readonly accessCode: string | null;
  readonly seedPasswordSet: boolean;
  readonly idleMinutes: number;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export class ConfigurationError extends Error {
  constructor(readonly variables: readonly string[]) {
    super(`invalid configuration: ${variables.join(', ')}`);
    this.name = 'ConfigurationError';
  }
}

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new ConfigurationError([...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))]);
  }
  const env = parsed.data;
  const appUrl = new URL(env.APP_URL);
  cached = {
    mode: env.APP_MODE,
    demoToolsRaw: env.DEMO_TOOLS,
    demoToolsEnabled: env.APP_MODE === 'demo' && env.DEMO_TOOLS === 'true',
    aiExternalAllowed: env.AI_EXTERNAL_ALLOWED === 'true',
    appUrl: appUrl.origin,
    appOrigin: appUrl.origin,
    databaseUrl: env.DATABASE_URL,
    sessionSecret: Buffer.from(env.SESSION_SECRET, 'base64'),
    masterKey: Buffer.from(env.SECRETS_MASTER_KEY, 'base64'),
    accessCode: env.APP_MODE === 'demo' ? (env.ACCESS_CODE ?? null) : null,
    seedPasswordSet: (env.SEED_DEMO_PASSWORD ?? '') !== '',
    idleMinutes: clampIdleMinutes(env.SESSION_IDLE_MINUTES === undefined ? undefined : Number(env.SESSION_IDLE_MINUTES)),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
  return cached;
}

export function isDemoMode(): boolean {
  return getEnv().mode === 'demo';
}

export function demoToolsEnabled(): boolean {
  return getEnv().demoToolsEnabled;
}

/** For tests that change variables between cases. */
export function resetEnvCache(): void {
  cached = null;
}
