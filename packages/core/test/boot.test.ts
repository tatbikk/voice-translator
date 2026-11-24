import { describe, expect, it } from 'vitest';
import { evaluateBoot, type BootInput, type BootViolation } from '../src/index';

const cleanDb = {
  reachable: true,
  stamp: 'production' as const,
  demoRows: 0,
  clockOffsetSeconds: 0,
  runtimeRoleIsPrivileged: false,
  runtimeRoleOwnsEvent: false,
  runtimeRoleCanModifyEvent: false,
};

const production: BootInput = {
  mode: 'production',
  demoToolsRaw: 'false',
  demoRoutesBuilt: false,
  accessCodeLength: 0,
  appUrl: 'https://mahkama.example',
  sessionSecretBytes: 48,
  masterKeyBytes: 32,
  secretsEqual: false,
  seedPasswordSet: false,
  components: [
    { id: 'messaging', implementation: 'real' },
    { id: 'professional-identity', implementation: 'real' },
  ],
  db: cleanDb,
};

const demo: BootInput = {
  ...production,
  mode: 'demo',
  demoToolsRaw: 'true',
  demoRoutesBuilt: true,
  accessCodeLength: 24,
  appUrl: 'http://localhost:3000',
  seedPasswordSet: true,
  components: [
    { id: 'messaging', implementation: 'simulated' },
    { id: 'professional-identity', implementation: 'simulated' },
  ],
  db: { ...cleanDb, stamp: 'demo', demoRows: 40, clockOffsetSeconds: 86_400 },
};

const violations = (input: BootInput): readonly BootViolation[] => {
  const result = evaluateBoot(input);
  return result.ok ? [] : result.violations;
};

describe('production mode', () => {
  it('boots when everything is real and clean', () => {
    expect(evaluateBoot(production).ok).toBe(true);
  });

  const cases: [string, Partial<BootInput>, BootViolation][] = [
    ['a simulated component', { components: [{ id: 'messaging', implementation: 'simulated' }] }, 'SIMULATED_COMPONENT'],
    ['DEMO_TOOLS=true (refused, not ignored)', { demoToolsRaw: 'true' }, 'DEMO_TOOLS_ENABLED'],
    ['demo routes in the build', { demoRoutesBuilt: true }, 'DEMO_ROUTES_BUILT'],
    ['a seed password', { seedPasswordSet: true }, 'SEED_PASSWORD_SET'],
    ['an http URL', { appUrl: 'http://mahkama.example' }, 'APP_URL_NOT_HTTPS'],
    ['a database not stamped production', { db: { ...cleanDb, stamp: null } }, 'DATABASE_NOT_STAMPED_PRODUCTION'],
    ['a database stamped demo', { db: { ...cleanDb, stamp: 'demo' } }, 'DATABASE_NOT_STAMPED_PRODUCTION'],
    ['demo rows', { db: { ...cleanDb, demoRows: 1 } }, 'DEMO_ROWS_PRESENT'],
    ['an advanced clock', { db: { ...cleanDb, clockOffsetSeconds: 60 } }, 'CLOCK_OFFSET_NONZERO'],
  ];
  for (const [label, change, expected] of cases) {
    it(`refuses to boot with ${label}`, () => {
      expect(violations({ ...production, ...change })).toContain(expected);
    });
  }

  it('refuses the demo configuration as a whole, listing every reason', () => {
    const v = violations({ ...demo, mode: 'production' });
    for (const expected of [
      'SIMULATED_COMPONENT',
      'DEMO_TOOLS_ENABLED',
      'DEMO_ROUTES_BUILT',
      'SEED_PASSWORD_SET',
      'APP_URL_NOT_HTTPS',
      'DATABASE_NOT_STAMPED_PRODUCTION',
      'DEMO_ROWS_PRESENT',
      'CLOCK_OFFSET_NONZERO',
    ] as const) {
      expect(v).toContain(expected);
    }
  });
});

describe('every mode', () => {
  const both: [string, BootInput][] = [
    ['production', production],
    ['demo', demo],
  ];
  for (const [mode, input] of both) {
    it(`${mode}: refuses weak or reused secrets`, () => {
      expect(violations({ ...input, sessionSecretBytes: 16 })).toContain('SESSION_SECRET_TOO_SHORT');
      expect(violations({ ...input, masterKeyBytes: 16 })).toContain('MASTER_KEY_INVALID');
      expect(violations({ ...input, secretsEqual: true })).toContain('SECRETS_EQUAL');
    });

    it(`${mode}: refuses a database role able to rewrite the event log`, () => {
      const db = input.db!;
      expect(violations({ ...input, db: { ...db, runtimeRoleIsPrivileged: true } })).toContain('RUNTIME_ROLE_TOO_POWERFUL');
      expect(violations({ ...input, db: { ...db, runtimeRoleOwnsEvent: true } })).toContain('RUNTIME_ROLE_OWNS_EVENT');
      expect(violations({ ...input, db: { ...db, runtimeRoleCanModifyEvent: true } })).toContain(
        'RUNTIME_ROLE_CAN_MODIFY_EVENT',
      );
    });

    it(`${mode}: refuses an unreachable database and a test component`, () => {
      expect(violations({ ...input, db: { ...input.db!, reachable: false } })).toContain('DB_UNREACHABLE');
      expect(violations({ ...input, components: [{ id: 'messaging', implementation: 'test' }] })).toContain(
        'TEST_COMPONENT',
      );
    });
  }
});

describe('demo mode', () => {
  it('boots with simulated components, demo tools and demo data', () => {
    expect(evaluateBoot(demo).ok).toBe(true);
  });

  it('refuses to run without demo tools, since no confirmation code could be delivered', () => {
    expect(violations({ ...demo, demoToolsRaw: 'false' })).toContain('DEMO_WITHOUT_TOOLS');
  });

  it('refuses a visitor passphrase shorter than twenty characters', () => {
    expect(violations({ ...demo, accessCodeLength: 19 })).toContain('ACCESS_CODE_TOO_SHORT');
  });

  it('refuses to be pointed at a production database', () => {
    expect(violations({ ...demo, db: { ...demo.db!, stamp: 'production' } })).toContain('DATABASE_STAMPED_PRODUCTION');
  });

  it('warns, without refusing, on a database not yet stamped', () => {
    const result = evaluateBoot({ ...demo, db: { ...demo.db!, stamp: null } });
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain('DATABASE_NOT_STAMPED');
  });
});
