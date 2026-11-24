import 'server-only';
import { evaluateBoot, simulatedComponents, type BootDatabaseFacts, type BootResult } from '@mahkama/core';
import { ConfigurationError, getEnv } from '../config/env';
import { getDb } from '../db';
import { appendStandaloneEvent } from '../events/append';
import { replaceableComponents } from '../components/registry';
import { log, errorFields } from '../log';

// Gathers the facts the boot check needs (contract §4.4) and refuses to start
// when one rule is broken: production mode with a simulated component, a demo
// tool, demo routes, demo data or an advanced clock; any mode with weak secrets
// or a database role able to rewrite the event log.

async function databaseFacts(): Promise<BootDatabaseFacts> {
  const db = getDb();
  try {
    const role = await db.$queryRaw<{ privileged: boolean; owns: boolean; modify: boolean }[]>`
      SELECT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls) AS "privileged",
             COALESCE((SELECT c.relowner = r.oid FROM pg_class c WHERE c.oid = to_regclass('"Event"')), false) AS "owns",
             (has_table_privilege(r.oid, '"Event"', 'UPDATE')
              OR has_table_privilege(r.oid, '"Event"', 'DELETE')
              OR has_table_privilege(r.oid, '"Event"', 'TRUNCATE')) AS "modify"
        FROM pg_roles r WHERE r.rolname = current_user`;
    const state = await db.systemState.findUnique({ where: { id: 1 }, select: { databaseMode: true } });
    const clockRow = await db.platformClock.findUnique({ where: { id: 1 }, select: { offsetSeconds: true } });
    const [users, cases, hearings, organizations] = await Promise.all([
      db.user.count({ where: { isDemo: true } }),
      db.caseFile.count({ where: { isDemo: true } }),
      db.hearing.count({ where: { isDemo: true } }),
      db.organization.count({ where: { isDemo: true } }),
    ]);
    const stamp = state?.databaseMode === 'demo' || state?.databaseMode === 'production' ? state.databaseMode : null;
    return {
      reachable: true,
      stamp,
      demoRows: users + cases + hearings + organizations,
      clockOffsetSeconds: clockRow ? Number(clockRow.offsetSeconds) : 0,
      runtimeRoleIsPrivileged: role[0]?.privileged ?? true,
      runtimeRoleOwnsEvent: role[0]?.owns ?? true,
      runtimeRoleCanModifyEvent: role[0]?.modify ?? true,
    };
  } catch (error) {
    log.error('boot check: database unreachable', errorFields(error));
    return {
      reachable: false,
      stamp: null,
      demoRows: 0,
      clockOffsetSeconds: 0,
      runtimeRoleIsPrivileged: false,
      runtimeRoleOwnsEvent: false,
      runtimeRoleCanModifyEvent: false,
    };
  }
}

export async function evaluateBootFacts(): Promise<BootResult> {
  const env = getEnv();
  const components = replaceableComponents();
  return evaluateBoot({
    mode: env.mode,
    demoToolsRaw: env.demoToolsRaw,
    // Inlined at build time by next.config.ts; absent (false) in the worker bundle.
    demoRoutesBuilt: process.env.DEMO_ROUTES_BUILT === 'true',
    accessCodeLength: env.accessCode?.length ?? 0,
    appUrl: env.appUrl,
    sessionSecretBytes: env.sessionSecret.length,
    masterKeyBytes: env.masterKey.length,
    secretsEqual: env.sessionSecret.equals(env.masterKey),
    seedPasswordSet: env.seedPasswordSet,
    components: components.map((c) => ({ id: c.id, implementation: c.implementation })),
    db: await databaseFacts(),
  });
}

/** Runs the check and stops the process on any violation. */
export async function enforceBoot(processName: 'web' | 'worker'): Promise<void> {
  let result: BootResult;
  try {
    result = await evaluateBootFacts();
  } catch (error) {
    const variables = error instanceof ConfigurationError ? error.variables.join(',') : null;
    log.error('boot refused: configuration', { process: processName, variables, ...errorFields(error) });
    process.exit(1);
  }
  for (const warning of result.warnings) log.warn('boot warning', { process: processName, warning });
  if (!result.ok) {
    log.error('boot refused', { process: processName, violations: result.violations.join(',') });
    process.exit(1);
  }
  const env = getEnv();
  await appendStandaloneEvent({
    action: 'system.boot',
    details: { mode: env.mode, simulatedComponents: simulatedComponents(replaceableComponents()).length, process: processName },
  });
  log.info('boot accepted', { process: processName, mode: env.mode });
}
