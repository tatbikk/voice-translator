// Boot check (contract §4.4, rule 9 of the prompt): the platform refuses to
// start in production mode while a simulated component, a demo tool, a demo
// route, demo data or an advanced clock remains, and in any mode with weak
// secrets or a database role able to rewrite the event log.
import type { ComponentImplementation } from './components';

export type BootViolation =
  | 'DB_UNREACHABLE'
  | 'SESSION_SECRET_TOO_SHORT'
  | 'MASTER_KEY_INVALID'
  | 'SECRETS_EQUAL'
  | 'TEST_COMPONENT'
  | 'RUNTIME_ROLE_TOO_POWERFUL'
  | 'RUNTIME_ROLE_OWNS_EVENT'
  | 'RUNTIME_ROLE_CAN_MODIFY_EVENT'
  | 'OWNER_DATABASE_URL_PRESENT'
  | 'SCHEMA_NOT_MIGRATED'
  | 'DEMO_WITHOUT_TOOLS'
  | 'ACCESS_CODE_TOO_SHORT'
  | 'DATABASE_STAMPED_PRODUCTION'
  | 'SIMULATED_COMPONENT'
  | 'DEMO_TOOLS_ENABLED'
  | 'DEMO_ROUTES_BUILT'
  | 'SEED_PASSWORD_SET'
  | 'DATABASE_NOT_STAMPED_PRODUCTION'
  | 'DEMO_ROWS_PRESENT'
  | 'CLOCK_OFFSET_NONZERO'
  | 'APP_URL_NOT_HTTPS';

export type BootWarning = 'DATABASE_NOT_STAMPED' | 'NO_DATABASE_FACTS';

export interface BootDatabaseFacts {
  readonly reachable: boolean;
  readonly stamp: 'demo' | 'production' | null;
  readonly demoRows: number;
  readonly clockOffsetSeconds: number;
  /** superuser, or any of CREATEROLE, CREATEDB, REPLICATION, BYPASSRLS */
  readonly runtimeRoleIsPrivileged: boolean;
  readonly runtimeRoleOwnsEvent: boolean;
  readonly runtimeRoleCanModifyEvent: boolean;
  /** the newest migration shipped with the code is applied to the database */
  readonly schemaUpToDate: boolean;
}

export interface BootInput {
  readonly mode: 'demo' | 'production';
  /** the raw variable, so that production refuses DEMO_TOOLS=true instead of ignoring it */
  readonly demoToolsRaw: 'true' | 'false';
  readonly demoRoutesBuilt: boolean;
  readonly accessCodeLength: number;
  readonly appUrl: string;
  readonly sessionSecretBytes: number;
  readonly masterKeyBytes: number;
  readonly secretsEqual: boolean;
  readonly seedPasswordSet: boolean;
  /**
   * The owner role's connection is in the environment of the web or worker
   * process: whoever ran code in it could rewrite the event log. Only the release
   * step holds it (review A-01).
   */
  readonly ownerDatabaseUrlPresent: boolean;
  readonly components: readonly { readonly id: string; readonly implementation: ComponentImplementation }[];
  /** null when the process has no database (should not happen for web and worker) */
  readonly db: BootDatabaseFacts | null;
}

export type BootResult =
  | { readonly ok: true; readonly warnings: readonly BootWarning[] }
  | { readonly ok: false; readonly violations: readonly BootViolation[]; readonly warnings: readonly BootWarning[] };

export const MIN_SESSION_SECRET_BYTES = 32;
export const MASTER_KEY_BYTES = 32;
export const MIN_ACCESS_CODE_LENGTH = 20;

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function evaluateBoot(input: BootInput): BootResult {
  const violations: BootViolation[] = [];
  const warnings: BootWarning[] = [];
  const add = (v: BootViolation) => {
    if (!violations.includes(v)) violations.push(v);
  };

  // Every mode.
  if (input.sessionSecretBytes < MIN_SESSION_SECRET_BYTES) add('SESSION_SECRET_TOO_SHORT');
  if (input.masterKeyBytes !== MASTER_KEY_BYTES) add('MASTER_KEY_INVALID');
  if (input.secretsEqual) add('SECRETS_EQUAL');
  if (input.components.some((c) => c.implementation === 'test')) add('TEST_COMPONENT');
  if (input.ownerDatabaseUrlPresent) add('OWNER_DATABASE_URL_PRESENT');

  const db = input.db;
  if (db === null) {
    warnings.push('NO_DATABASE_FACTS');
  } else if (!db.reachable) {
    add('DB_UNREACHABLE');
  } else {
    if (db.runtimeRoleIsPrivileged) add('RUNTIME_ROLE_TOO_POWERFUL');
    if (db.runtimeRoleOwnsEvent) add('RUNTIME_ROLE_OWNS_EVENT');
    if (db.runtimeRoleCanModifyEvent) add('RUNTIME_ROLE_CAN_MODIFY_EVENT');
    // The release step runs in its own service: until it has applied the
    // migrations of this version, the new code refuses to start.
    if (!db.schemaUpToDate) add('SCHEMA_NOT_MIGRATED');
  }

  if (input.mode === 'demo') {
    // Without the outbox no confirmation code can be delivered: nobody could log in.
    if (input.demoToolsRaw !== 'true') add('DEMO_WITHOUT_TOOLS');
    if (input.accessCodeLength < MIN_ACCESS_CODE_LENGTH) add('ACCESS_CODE_TOO_SHORT');
    // A demo deployment must never be pointed at a production database.
    if (db?.reachable && db.stamp === 'production') add('DATABASE_STAMPED_PRODUCTION');
    if (db?.reachable && db.stamp === null) warnings.push('DATABASE_NOT_STAMPED');
  } else {
    if (input.components.some((c) => c.implementation === 'simulated')) add('SIMULATED_COMPONENT');
    if (input.demoToolsRaw === 'true') add('DEMO_TOOLS_ENABLED');
    if (input.demoRoutesBuilt) add('DEMO_ROUTES_BUILT');
    if (input.seedPasswordSet) add('SEED_PASSWORD_SET');
    if (!isHttps(input.appUrl)) add('APP_URL_NOT_HTTPS');
    if (db?.reachable) {
      if (db.stamp !== 'production') add('DATABASE_NOT_STAMPED_PRODUCTION');
      if (db.demoRows > 0) add('DEMO_ROWS_PRESENT');
      if (db.clockOffsetSeconds !== 0) add('CLOCK_OFFSET_NONZERO');
    }
  }

  return violations.length === 0 ? { ok: true, warnings } : { ok: false, violations, warnings };
}
