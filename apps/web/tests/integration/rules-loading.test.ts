// Loading the dated rule tables (src/cli/load-rules.ts), run as the release
// step runs it, and the constraints of "RuleSet" in the database.
// - Review P1-S-10 / P1-A-07: a version and its rules.loaded event are written
//   in one transaction, and the loading time is the platform's clock.
// - Review P1-A-18: kinds and days are checked by the database, two versions of
//   one kind never overlap, and the migration applies on the Phase 1 rows.
import { join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ruleContentSha256, ruleSourceFiles } from '@/server/rules/store';
import { migrateDeploy, runProcess, type ProcessResult } from '../helpers/cli';
import { count, events, ownerClient, sql } from '../helpers/db';
import { useFreshDatabase } from '../helpers/reset';

useFreshDatabase();

const DAY_MS = 86_400_000;
const OFFSET_DAYS = 30;
const files = ruleSourceFiles();

function loadRules(): ProcessResult {
  return runProcess(process.execPath, [join('dist-server', 'load-rules.mjs')]);
}

const ruleRows = () => sql<{ kind: string; version: string; contentSha256: string; loadedAt: Date }>(`SELECT kind, version, "contentSha256", "loadedAt" FROM "RuleSet" ORDER BY kind, version`);

describe('loading the rule tables (review P1-S-10, P1-A-07)', () => {
  beforeAll(async () => {
    // The platform clock of the demo environment, a month ahead of the system time.
    await sql(`UPDATE "PlatformClock" SET "offsetSeconds" = $1 WHERE id = 1`, [OFFSET_DAYS * 86_400]);
  });

  it('loads every version of rules/*.json, each with its rules.loaded event, at platform time', async () => {
    const result = loadRules();
    expect(result.status, result.output.slice(-2000)).toBe(0);
    const rows = await ruleRows();
    expect(rows.map((r) => `${r.kind} ${r.version}`).sort()).toEqual(files.map((f) => `${f.kind} ${f.version}`).sort());
    const loaded = await events('rules.loaded');
    expect(loaded).toHaveLength(files.length);
    for (const row of rows) {
      const event = loaded.find((e) => e.details.kind === row.kind && e.details.version === row.version);
      expect(event?.details.contentSha256, `${row.kind} ${row.version}`).toBe(row.contentSha256);
      // The platform clock, not the database's now().
      expect(Math.abs(row.loadedAt.getTime() - (Date.now() + OFFSET_DAYS * DAY_MS))).toBeLessThan(10 * 60_000);
      expect(Math.abs(row.loadedAt.getTime() - (event?.occurredAt.getTime() ?? 0))).toBeLessThan(60_000);
    }
  }, 120_000);

  it('loads nothing and records nothing the second time', async () => {
    const before = await count('SELECT count(*)::text AS n FROM "Event"');
    const result = loadRules();
    expect(result.status, result.output.slice(-2000)).toBe(0);
    expect(await count('SELECT count(*)::text AS n FROM "Event"')).toBe(before);
    expect(await ruleRows()).toHaveLength(files.length);
  }, 120_000);

  it('writes a version and its event together, or neither (one transaction)', async () => {
    const [last, beforeLast] = [files.at(-1), files.at(-2)];
    if (!last || !beforeLast) throw new Error('at least two rule tables are expected');
    await sql(`DELETE FROM "RuleSet" WHERE (kind, version) IN (($1, $2), ($3, $4))`, [last.kind, last.version, beforeLast.kind, beforeLast.version]);
    // The event of the last table cannot be written: the whole load must roll back.
    await sql(`CREATE FUNCTION "test_refuse_rules_event"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test: event refused'; END; $$`);
    await sql(`CREATE TRIGGER "test_refuse_rules_event" BEFORE INSERT ON "Event" FOR EACH ROW
      WHEN (NEW.action = 'rules.loaded' AND NEW.details->>'kind' = '${last.kind}' AND NEW.details->>'version' = '${last.version}')
      EXECUTE FUNCTION "test_refuse_rules_event"()`);
    const eventsBefore = await count('SELECT count(*)::text AS n FROM "Event"');
    try {
      const failed = loadRules();
      expect(failed.status).not.toBe(0);
      expect(await ruleRows(), 'neither table is loaded').toHaveLength(files.length - 2);
      expect(await count('SELECT count(*)::text AS n FROM "Event"'), 'no event is left behind').toBe(eventsBefore);
    } finally {
      await sql(`DROP TRIGGER "test_refuse_rules_event" ON "Event"`);
      await sql(`DROP FUNCTION "test_refuse_rules_event"()`);
    }
    const result = loadRules();
    expect(result.status, result.output.slice(-2000)).toBe(0);
    expect(await ruleRows()).toHaveLength(files.length);
    expect(await events('rules.loaded')).toHaveLength(files.length + 2);
  }, 120_000);

  it('refuses a content changed under a loaded version, and writes nothing', async () => {
    const [changed, missing] = [files[0], files.at(-1)];
    if (!changed || !missing || changed === missing) throw new Error('at least two rule tables are expected');
    await sql(`UPDATE "RuleSet" SET "contentSha256" = repeat('a', 64) WHERE kind = $1 AND version = $2`, [changed.kind, changed.version]);
    await sql(`DELETE FROM "RuleSet" WHERE kind = $1 AND version = $2`, [missing.kind, missing.version]);
    const eventsBefore = await count('SELECT count(*)::text AS n FROM "Event"');
    const result = loadRules();
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('RULE_TABLE_CHANGED');
    expect(await ruleRows()).toHaveLength(files.length - 1);
    expect(await count('SELECT count(*)::text AS n FROM "Event"')).toBe(eventsBefore);
    // Back to the files' state for the next tests.
    await sql(`UPDATE "RuleSet" SET "contentSha256" = $3 WHERE kind = $1 AND version = $2`, [changed.kind, changed.version, changed.contentSha256]);
    expect(loadRules().status).toBe(0);
  }, 120_000);
});

describe('a version loaded open-ended is closed when its successor comes (review P1-A-18)', () => {
  /**
   * The release on a database that holds the first version of a table as it was loaded,
   * open-ended and without its successor: the version is closed, the successor loaded, both recorded.
   */
  async function upgrade(kind: 'HOLIDAYS' | 'REFERRALS' | 'FEES'): Promise<{ closed: (typeof files)[number]; successor: (typeof files)[number] }> {
    const closed = files.find((f) => f.kind === kind && f.validTo !== null);
    const successor = files.find((f) => f.kind === kind && f.validTo === null);
    if (!closed || !successor) throw new Error(`the ${kind} table holds a closed version and its successor`);
    expect(successor.validFrom).toBe(closed.validTo);

    // The database as the earlier release left it: the first version open-ended, no successor.
    const asLoaded = { ...(closed.content as Record<string, unknown>), validTo: null };
    await sql(`DELETE FROM "RuleSet" WHERE kind = $1`, [kind]);
    await sql(
      `INSERT INTO "RuleSet" (id, kind, version, "validFrom", "validTo", "contentSha256", content, "loadedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, NULL, $4, $5::jsonb, now())`,
      [kind, closed.version, closed.validFrom, ruleContentSha256(asLoaded), JSON.stringify(asLoaded)],
    );
    const seq = Number((await sql<{ seq: string }>(`SELECT coalesce(max(seq), 0)::text AS seq FROM "Event"`))[0]?.seq ?? 0);

    const result = loadRules();
    expect(result.status, result.output.slice(-2000)).toBe(0);
    const rows = await sql<{ version: string; validTo: string | null; contentSha256: string; contentValidTo: string | null }>(
      `SELECT version, "validTo", "contentSha256", content->>'validTo' AS "contentValidTo" FROM "RuleSet" WHERE kind = $1 ORDER BY "validFrom"`,
      [kind],
    );
    expect(rows).toEqual([
      { version: closed.version, validTo: closed.validTo, contentSha256: closed.contentSha256, contentValidTo: closed.validTo },
      { version: successor.version, validTo: null, contentSha256: successor.contentSha256, contentValidTo: null },
    ]);
    const appended = (await events()).filter((e) => e.seq > seq);
    expect(appended.map((e) => [e.action, e.details])).toEqual([
      [
        'rules.closed',
        { kind, version: closed.version, validTo: closed.validTo, previousSha256: ruleContentSha256(asLoaded), contentSha256: closed.contentSha256 },
      ],
      ['rules.loaded', { kind, version: successor.version, contentSha256: successor.contentSha256 }],
    ]);
    // And nothing more on the next release.
    expect(loadRules().status).toBe(0);
    expect((await events()).filter((e) => e.seq > seq)).toHaveLength(2);
    return { closed, successor };
  }

  it('upgrades the holiday table loaded by Phase 1: closes it, loads the version with a horizon, records both', async () => {
    const { successor } = await upgrade('HOLIDAYS');
    expect((successor.content as { coversUntil?: string }).coversUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }, 120_000);

  it('upgrades the referral table loaded by Phase 2: closes it, loads the version that communicates every public-law person, records both (independent review IR-01)', async () => {
    const { closed, successor } = await upgrade('REFERRALS');
    const communication = (table: { content: unknown }) =>
      (table.content as { prosecution: { communication: { anyPublicLawPerson?: number; publicEntityKinds: Record<string, number> } } }).prosecution.communication;
    // The version loaded by Phase 2 is kept as it was applied; its successor names any public-law person.
    expect(communication(closed).anyPublicLawPerson).toBeUndefined();
    expect(Object.keys(communication(closed).publicEntityKinds).sort()).toEqual(['LOCAL_AUTHORITY', 'OTHER_PUBLIC', 'PUBLIC_ESTABLISHMENT', 'STATE']);
    expect(communication(successor).anyPublicLawPerson).toBe(1);
    expect(communication(successor).publicEntityKinds).toMatchObject({ STATE_JUDICIAL_AGENT: 1, LOCAL_AUTHORITIES_AGENT: 1 });
  }, 120_000);

  it('upgrades the fee table loaded by Phase 1: closes it, loads the version that marks every band, the way the bands apply and the fee of an unvalued claim uncertain, records both (independent review IR-03, IR-04)', async () => {
    const { closed, successor } = await upgrade('FEES');
    const schedule = (table: { content: unknown }) =>
      (table.content as { schedule: { bands: { rateBasisPoints: number; uncertain: boolean }[]; method?: { value: string; uncertain: boolean }; unvaluedClaimFee?: { value: number; uncertain: boolean } } }).schedule;
    // The version loaded by Phase 1 is kept as it was applied; its successor has the same rates, all marked.
    expect(schedule(closed).bands.map((band) => band.uncertain)).toEqual([false, false, true]);
    expect(schedule(closed).method).toBeUndefined();
    expect(schedule(closed).unvaluedClaimFee).toBeUndefined();
    expect(schedule(successor).bands.map((band) => band.rateBasisPoints)).toEqual(schedule(closed).bands.map((band) => band.rateBasisPoints));
    expect(schedule(successor).bands.map((band) => band.uncertain)).toEqual([true, true, true]);
    expect(schedule(successor).method).toMatchObject({ value: 'BAND_RATE_ON_WHOLE_BASE', uncertain: true });
    expect(schedule(successor).unvaluedClaimFee).toMatchObject({ value: 0, uncertain: true });
  }, 120_000);
});

describe('the constraints of "RuleSet" (review P1-A-18)', () => {
  let client: pg.Client;
  beforeAll(async () => {
    client = await ownerClient();
  });
  afterAll(async () => {
    await client.end();
  });

  /** The SQLSTATE of the statement, run in a transaction that is then rolled back. */
  async function outcome(...statements: string[]): Promise<string> {
    await client.query('BEGIN');
    try {
      for (const statement of statements) await client.query(statement);
      return 'OK';
    } catch (error) {
      return String((error as { code?: unknown }).code);
    } finally {
      await client.query('ROLLBACK');
    }
  }

  // Other test files load the tables of Phase 2 in force from 2026 with no end: the
  // checks below use days of 2001, when no version of any kind is in force.
  const FREE_FROM = '2001-01-01';
  const FREE_TO = '2001-06-30';

  const insert = (kind: string, version: string, validFrom: string, validTo: string | null) =>
    `INSERT INTO "RuleSet" (id, kind, version, "validFrom", "validTo", "contentSha256", content)
     VALUES (gen_random_uuid(), '${kind}', '${version}', '${validFrom}', ${validTo === null ? 'NULL' : `'${validTo}'`}, repeat('0', 64), '{}'::jsonb)`;

  it('refuses an unknown kind, and accepts those of Phase 2', async () => {
    expect(await outcome(insert('NO_SUCH_KIND', 'x', '2030-01-01', null))).toBe('23514');
    for (const kind of ['CASE_TYPES', 'DISTRICTS', 'REFERRALS', 'JURISDICTION']) {
      expect(await outcome(insert(kind, '2001-01-01.1', FREE_FROM, FREE_TO)), kind).toBe('OK');
    }
  });

  it('refuses a day that is not written YYYY-MM-DD or does not exist', async () => {
    for (const day of ['2026/11/25', '25-11-2026', '2026-11-5', '2026-02-30', '2026-13-01', '0000-01-01', '']) {
      expect(await outcome(insert('CASE_TYPES', 'x', day, FREE_TO)), `validFrom ${day}`).toBe('23514');
      expect(await outcome(insert('CASE_TYPES', 'x', FREE_FROM, day)), `validTo ${day}`).toBe('23514');
    }
  });

  it('refuses an end that does not come after the start', async () => {
    expect(await outcome(insert('CASE_TYPES', 'x', FREE_FROM, FREE_FROM))).toBe('23514');
    expect(await outcome(insert('CASE_TYPES', 'x', FREE_FROM, '2000-12-31'))).toBe('23514');
    expect(await outcome(insert('CASE_TYPES', 'x', FREE_FROM, '2001-01-02'))).toBe('OK');
  });

  it('refuses two versions of one kind in force on the same day, by insertion or by update', async () => {
    const [table] = files;
    if (!table) throw new Error('no rule table');
    const later = '2031-01-01';
    expect(await outcome(insert(table.kind, 'overlapping', later, null))).toBe('23P01');
    expect(await outcome(insert(table.kind, 'before', '2020-01-01', '2026-08-24'))).toBe('23P01');
    // Closed first, the newer version starts where the older ends.
    const close = `UPDATE "RuleSet" SET "validTo" = '${later}' WHERE kind = '${table.kind}' AND version = '${table.version}'`;
    expect(await outcome(close, insert(table.kind, 'newer', later, null))).toBe('OK');
    expect(await outcome(close, insert(table.kind, 'newer', later, null), `UPDATE "RuleSet" SET "validTo" = NULL WHERE version = '${table.version}' AND kind = '${table.kind}'`)).toBe('23P01');
    // Another kind may be in force on the same days (a kind other than the table's, in the free window).
    const otherKind = table.kind === 'CASE_TYPES' ? 'DISTRICTS' : 'CASE_TYPES';
    expect(await outcome(insert(table.kind, 'window', FREE_FROM, FREE_TO), insert(otherKind, 'same-days', FREE_FROM, FREE_TO))).toBe('OK');
  });

  it('refuses a write at REPEATABLE READ, whose snapshot could miss a concurrent version', async () => {
    expect(await outcome('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', insert('CASE_TYPES', 'x', '2030-01-01', null))).toBe('25000');
  });

  it('applies on a database that holds the rule rows of Phase 1', async () => {
    // Back to the state before the migration, with the four tables Phase 1 loads.
    await sql(`DROP TRIGGER "rule_set_no_overlap" ON "RuleSet"`);
    await sql(`ALTER TABLE "RuleSet" DROP CONSTRAINT "RuleSet_kind_check", DROP CONSTRAINT "RuleSet_validFrom_check", DROP CONSTRAINT "RuleSet_validTo_check"`);
    await sql(`DROP FUNCTION "rule_set_no_overlap"()`);
    await sql(`DROP FUNCTION "rule_set_days"(text, text)`);
    await sql(`DROP FUNCTION "rule_set_day"(text)`);
    await sql(`DELETE FROM "_prisma_migrations" WHERE migration_name = '20261125150000_rules_constraints'`);
    await sql(`DELETE FROM "RuleSet"`);
    for (const kind of ['TIME_LIMITS', 'FEES', 'HOLIDAYS', 'INTEREST']) {
      await sql(
        `INSERT INTO "RuleSet" (id, kind, version, "validFrom", "validTo", "contentSha256", content, "loadedAt")
         VALUES (gen_random_uuid(), $1, '2026-08-23.1', '2026-08-23', NULL, repeat('0', 64), '{}'::jsonb, now())`,
        [kind],
      );
    }
    migrateDeploy();
    const constraints = await sql<{ conname: string }>(`SELECT conname FROM pg_constraint WHERE conrelid = '"RuleSet"'::regclass AND contype = 'c' ORDER BY conname`);
    expect(constraints.map((c) => c.conname)).toEqual(['RuleSet_kind_check', 'RuleSet_validFrom_check', 'RuleSet_validTo_check']);
    expect(await count(`SELECT count(*)::text AS n FROM pg_trigger WHERE tgname = 'rule_set_no_overlap'`)).toBe(1);
    expect(await outcome(insert('TIME_LIMITS', 'overlapping', '2031-01-01', null))).toBe('23P01');
  }, 120_000);
});
