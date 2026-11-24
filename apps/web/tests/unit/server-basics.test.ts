// Unit tests of the server foundations that need no database: configuration
// parsing, per-purpose keys, password hashing and the technical log's redaction.
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationError, getEnv, resetEnvCache } from '@/server/config/env';
import { clearKeyCache, hmacHex, identifierHash, masterKey, sessionKey } from '@/server/keys';
import { acceptablePassword, hashPassword, needsRehash, verifyPassword } from '@/server/auth/passwords';
import { errorFields, log } from '@/server/log';

const VARIABLES = [
  'APP_MODE',
  'DEMO_TOOLS',
  'AI_EXTERNAL_ALLOWED',
  'APP_URL',
  'DATABASE_URL',
  'SESSION_SECRET',
  'SECRETS_MASTER_KEY',
  'ACCESS_CODE',
  'SEED_DEMO_PASSWORD',
  'SESSION_IDLE_MINUTES',
  'LOG_LEVEL',
] as const;
const saved = Object.fromEntries(VARIABLES.map((name) => [name, process.env[name]]));

function setEnv(values: Partial<Record<(typeof VARIABLES)[number], string>>): void {
  for (const name of VARIABLES) Reflect.deleteProperty(process.env, name);
  Object.assign(process.env, values);
  resetEnvCache();
  clearKeyCache();
}

const valid = () => ({
  APP_MODE: 'demo',
  DEMO_TOOLS: 'true',
  AI_EXTERNAL_ALLOWED: 'false',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://runtime@localhost:5432/unit',
  SESSION_SECRET: randomBytes(48).toString('base64'),
  SECRETS_MASTER_KEY: randomBytes(32).toString('base64'),
  ACCESS_CODE: 'x'.repeat(24),
});

function configurationErrorOf(): readonly string[] {
  try {
    getEnv();
  } catch (error) {
    if (error instanceof ConfigurationError) return error.variables;
    throw error;
  }
  return [];
}

afterAll(() => {
  for (const name of VARIABLES) {
    const value = saved[name];
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
  resetEnvCache();
  clearKeyCache();
});

describe('configuration', () => {
  it('accepts a complete demo configuration and turns demo tools on', () => {
    setEnv(valid());
    const env = getEnv();
    expect(env.mode).toBe('demo');
    expect(env.demoToolsEnabled).toBe(true);
    expect(env.appOrigin).toBe('http://localhost:3000');
    expect(env.idleMinutes).toBe(30);
  });

  it('never enables demo tools in production, whatever DEMO_TOOLS says', () => {
    setEnv({ ...valid(), APP_MODE: 'production', APP_URL: 'https://court.example' });
    expect(getEnv().demoToolsEnabled).toBe(false);
    expect(getEnv().demoToolsRaw).toBe('true');
    expect(getEnv().accessCode).toBeNull();
  });

  it('reports invalid variables by name only', () => {
    setEnv({ ...valid(), SESSION_SECRET: 'short', SECRETS_MASTER_KEY: randomBytes(16).toString('base64') });
    const names = configurationErrorOf();
    expect(names).toEqual(expect.arrayContaining(['SESSION_SECRET', 'SECRETS_MASTER_KEY']));
    expect(names.join(' ')).not.toContain('short');
  });

  it('refuses a short visitor access code in demo mode', () => {
    setEnv({ ...valid(), ACCESS_CODE: 'too-short' });
    expect(configurationErrorOf()).toContain('ACCESS_CODE');
  });

  it('refuses a plain-HTTP address that is not local, and an address with a path', () => {
    setEnv({ ...valid(), APP_URL: 'http://court.example' });
    expect(configurationErrorOf()).toContain('APP_URL');
    setEnv({ ...valid(), APP_URL: 'https://court.example/app' });
    expect(configurationErrorOf()).toContain('APP_URL');
  });

  it('accepts only the literal booleans "true" and "false"', () => {
    setEnv({ ...valid(), DEMO_TOOLS: 'yes' });
    expect(configurationErrorOf()).toContain('DEMO_TOOLS');
  });

  it('clamps the idle timeout between 5 and 60 minutes', () => {
    setEnv({ ...valid(), SESSION_IDLE_MINUTES: '2' });
    expect(getEnv().idleMinutes).toBe(5);
    setEnv({ ...valid(), SESSION_IDLE_MINUTES: '600' });
    expect(getEnv().idleMinutes).toBe(60);
  });
});

describe('keys', () => {
  beforeEach(() => {
    setEnv(valid());
  });

  it('derives a different key for every purpose', () => {
    const keys = (['access-cookie', 'csrf', 'client-id', 'device-cookie', 'second-factor', 'identifier'] as const).map((p) =>
      sessionKey(p).toString('hex'),
    );
    keys.push(masterKey('secret-store-v1').toString('hex'), masterKey('event-chain-v1').toString('hex'));
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toHaveLength(64);
  });

  it('changes every key when the secret changes', () => {
    const before = sessionKey('csrf').toString('hex');
    setEnv(valid());
    expect(sessionKey('csrf').toString('hex')).not.toBe(before);
  });

  it('hashes identifiers case- and space-insensitively, never in clear', () => {
    const hash = identifierHash('  Someone@Example.MA ');
    expect(hash).toBe(identifierHash('someone@example.ma'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(hmacHex(sessionKey('client-id'), 'someone@example.ma'));
  });
});

describe('passwords', () => {
  it('hashes with Argon2id and the policy parameters', async () => {
    const stored = await hashPassword('a long enough passphrase');
    expect(stored.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(needsRehash(stored)).toBe(false);
    expect(await verifyPassword(stored, 'a long enough passphrase')).toBe(true);
    expect(await verifyPassword(stored, 'a long enough passphrasE')).toBe(false);
  });

  it('asks for a new hash when the stored one is weaker or unreadable', () => {
    expect(needsRehash('$argon2id$v=19$m=4096,t=3,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaA')).toBe(true);
    expect(needsRehash('not-a-hash')).toBe(true);
  });

  it('answers false for a missing hash, after a comparable amount of work', async () => {
    expect(await verifyPassword(null, 'whatever it is')).toBe(false);
  });

  it('refuses short or overlong passwords and passwords that contain the mailbox name', () => {
    expect(acceptablePassword('short', 'judge@example.ma')).toBe(false);
    expect(acceptablePassword('x'.repeat(129), 'judge@example.ma')).toBe(false);
    expect(acceptablePassword('my-judge-password-2026', 'judge@example.ma')).toBe(false);
    expect(acceptablePassword('correct horse battery staple', 'judge@example.ma')).toBe(true);
  });
});

describe('technical log', () => {
  let lines: string[] = [];

  beforeEach(() => {
    setEnv({ ...valid(), LOG_LEVEL: 'debug' });
    lines = [];
    const capture = (chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits fields that could carry personal data or secrets', () => {
    log.info('probe', {
      email: 'someone@example.ma',
      password: 'secret value',
      accessCode: 'abc',
      fullName: 'Someone',
      sessionToken: 'tok',
      userId: 'kept-id',
      requestReferenceHash: 'kept-hash',
      count: 3,
    });
    const entry = JSON.parse(lines.join('')) as Record<string, unknown>;
    expect(entry.email).toBe('[omitted]');
    expect(entry.password).toBe('[omitted]');
    expect(entry.accessCode).toBe('[omitted]');
    expect(entry.fullName).toBe('[omitted]');
    expect(entry.sessionToken).toBe('[omitted]');
    expect(entry.userId).toBe('kept-id');
    expect(entry.requestReferenceHash).toBe('kept-hash');
    expect(entry.count).toBe(3);
    expect(lines.join('')).not.toContain('someone@example.ma');
  });

  it('logs an error by class and code, never by message', () => {
    const error = Object.assign(new Error('value "someone@example.ma" violates constraint'), { code: 'P2002' });
    log.error('failed', errorFields(error));
    const text = lines.join('');
    expect(text).toContain('P2002');
    expect(text).not.toContain('someone@example.ma');
    expect(text).not.toContain('violates');
  });
});
