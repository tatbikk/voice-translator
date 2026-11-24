import 'server-only';
import { getEnv } from './config/env';
import { clock } from './clock';

// Technical log: JSON lines on stdout. Identifiers only: never a request body, a
// document, a name, an e-mail, a code, a token, a cookie or a secret. Errors
// are logged as class and code with a correlation id, never with their message
// (a database error message can carry row values).

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, string | number | boolean | null | undefined>;

const FORBIDDEN_KEYS = /pass|secret|token|code|cookie|email|phone|name|body|authorization/i;

function threshold(): number {
  try {
    return ORDER[getEnv().logLevel];
  } catch {
    return ORDER.info;
  }
}

function write(level: Level, msg: string, fields: LogFields = {}): void {
  if (ORDER[level] < threshold()) return;
  const safe: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    // Keys that could carry personal data or secrets are dropped, whatever the caller meant.
    safe[key] = FORBIDDEN_KEYS.test(key) && !key.endsWith('Id') && !key.endsWith('Hash') && key !== 'errorCode' ? '[omitted]' : value;
  }
  const line = JSON.stringify({ time: clock.systemNow().toISOString(), level, msg, ...safe });
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
    return { errorClass: error.name, errorCode: typeof code === 'string' || typeof code === 'number' ? String(code) : null };
  }
  return { errorClass: typeof error };
}

export const log = {
  debug: (msg: string, fields?: LogFields) => { write('debug', msg, fields); },
  info: (msg: string, fields?: LogFields) => { write('info', msg, fields); },
  warn: (msg: string, fields?: LogFields) => { write('warn', msg, fields); },
  error: (msg: string, fields?: LogFields) => { write('error', msg, fields); },
};
