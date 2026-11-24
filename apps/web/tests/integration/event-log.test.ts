// Memo row 15 and contract §8, §13 item 3: the event log cannot be rewritten.
// As the RUNTIME role (the application's own connection) UPDATE, DELETE,
// TRUNCATE, ALTER TABLE … DISABLE TRIGGER USER and DROP TABLE are denied; the
// triggers refuse changes even to the owner; and a deliberate tampering
// through the OWNER connection (triggers disabled, a row changed, triggers
// re-enabled) is reported by the chain verification (npm run events:verify,
// i.e. dist-server/verify-events.mjs), including when the attacker recomputes
// the hashes without the key, or deletes the last events.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, computeEventHash, type EventRecord, type JsonPrimitive, type LegalBasis } from '@mahkama/core';
import { visitor } from '../helpers/auth';
import { runBundled, type ProcessResult } from '../helpers/cli';
import { events, headSeq, one, ownerClient, runtimeClient, type EventRow } from '../helpers/db';
import { Client, nextIp } from '../helpers/http';
import { resetDatabase, useFreshDatabase } from '../helpers/reset';
import { findLeaks } from '../helpers/sensitive';

/** Appends events through the application: a visitor passes the gate, others are refused. */
async function generateEvents(refusals = 4): Promise<void> {
  await visitor();
  for (let i = 0; i < refusals; i += 1) await new Client({ ip: nextIp() }).get('/api/v1/notifications');
}

async function errorCodeOf(client: pg.Client, statement: string): Promise<string | null> {
  try {
    await client.query(statement);
    return null;
  } catch (error) {
    return String((error as { code?: unknown }).code);
  }
}

function verify(): ProcessResult {
  const result = runBundled('verify-events');
  expect(findLeaks(result.output, ['secret', 'password', 'code', 'token']), 'the verification output leaks nothing').toEqual([]);
  return result;
}

async function chainState(): Promise<{ chainStatus: string; brokenAtSeq: string | null; chainHeadSeq: string | null; chainHeadHash: string | null }> {
  return one('SELECT "chainStatus", "brokenAtSeq"::text, "chainHeadSeq"::text, "chainHeadHash" FROM "SystemState" WHERE id = 1');
}

/** Runs statements on the owner connection with the event-log triggers disabled. */
async function asOwnerWithoutTriggers(statements: (client: pg.Client) => Promise<void>): Promise<void> {
  const client = await ownerClient();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE "Event" DISABLE TRIGGER USER');
    await statements(client);
    await client.query('ALTER TABLE "Event" ENABLE TRIGGER USER');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

function toRecord(row: EventRow): EventRecord {
  return {
    seq: row.seq,
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    actorUserId: row.actorUserId,
    actorRoleAssignmentId: row.actorRoleAssignmentId,
    actorRole: row.actorRole,
    viaDemoSwitch: row.viaDemoSwitch,
    clientIdHash: row.clientIdHash,
    action: row.action,
    outcome: row.outcome as EventRecord['outcome'],
    caseFileId: row.caseFileId,
    legalBasis: row.legalBasis as LegalBasis | null,
    details: row.details as Record<string, JsonPrimitive>,
    keyVersion: row.keyVersion,
  };
}

describe('the event log cannot be rewritten (memo row 15)', () => {
  useFreshDatabase();

  describe('as the runtime role', () => {
    it('row 15: UPDATE, DELETE, TRUNCATE, DISABLE TRIGGER and DROP TABLE on the event log are all denied', async () => {
      await generateEvents();
      const client = await runtimeClient();
      try {
        const who = await client.query<{ u: string }>('SELECT current_user AS u');
        expect(who.rows[0]?.u, 'DATABASE_URL is the runtime role').not.toBe(new URL(process.env.MIGRATION_DATABASE_URL ?? '').username);
        const denied = {
          update: await errorCodeOf(client, `UPDATE "Event" SET outcome = 'DONE'`),
          delete: await errorCodeOf(client, 'DELETE FROM "Event"'),
          truncate: await errorCodeOf(client, 'TRUNCATE "Event"'),
          disableTrigger: await errorCodeOf(client, 'ALTER TABLE "Event" DISABLE TRIGGER USER'),
          dropTrigger: await errorCodeOf(client, 'DROP TRIGGER "event_no_update_or_delete" ON "Event"'),
          dropTable: await errorCodeOf(client, 'DROP TABLE "Event"'),
          changeOwner: await errorCodeOf(client, 'ALTER TABLE "Event" OWNER TO CURRENT_USER'),
          replaceFunction: await errorCodeOf(
            client,
            `CREATE OR REPLACE FUNCTION "event_log_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$`,
          ),
          replicationRole: await errorCodeOf(client, `SET session_replication_role = replica`),
          createTable: await errorCodeOf(client, 'CREATE TABLE "Shadow" (id int)'),
        };
        for (const [statement, code] of Object.entries(denied)) {
          expect(code, `${statement} must be refused for lack of privilege`).toBe('42501');
        }
      } finally {
        await client.end();
      }
      expect((await events()).length, 'the log is intact').toBeGreaterThan(0);
    });

    it('row 15: SELECT and INSERT remain possible (the application appends)', async () => {
      const client = await runtimeClient();
      try {
        expect(await errorCodeOf(client, 'SELECT count(*) FROM "Event"')).toBeNull();
        const privileges = await client.query<{ s: boolean; i: boolean; u: boolean; d: boolean; t: boolean }>(
          `SELECT has_table_privilege('"Event"', 'SELECT') AS s, has_table_privilege('"Event"', 'INSERT') AS i,
                  has_table_privilege('"Event"', 'UPDATE') AS u, has_table_privilege('"Event"', 'DELETE') AS d,
                  has_table_privilege('"Event"', 'TRUNCATE') AS t`,
        );
        expect(privileges.rows[0]).toEqual({ s: true, i: true, u: false, d: false, t: false });
        const owns = await client.query<{ owns: boolean }>(
          `SELECT c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AS owns FROM pg_class c WHERE c.oid = '"Event"'::regclass`,
        );
        expect(owns.rows[0]?.owns, 'the runtime role does not own the event log').toBe(false);
      } finally {
        await client.end();
      }
    });
  });

  describe('as the owner', () => {
    it('row 15: the triggers refuse UPDATE, DELETE and TRUNCATE even to the owner', async () => {
      await generateEvents(1);
      const client = await ownerClient();
      try {
        for (const statement of [`UPDATE "Event" SET outcome = 'DONE'`, 'DELETE FROM "Event"', 'TRUNCATE "Event"']) {
          const code = await errorCodeOf(client, statement);
          expect(code, `${statement} is refused by the append-only trigger`).not.toBeNull();
        }
      } finally {
        await client.end();
      }
    });

    it('the log is a chain: gap-free sequence from 1, each row carrying the hash of the one before', async () => {
      await generateEvents();
      const rows = await events();
      expect(rows.length).toBeGreaterThan(3);
      rows.forEach((row, index) => {
        expect(row.seq).toBe(index + 1);
        expect(row.prevHash).toBe(index === 0 ? GENESIS_HASH : rows[index - 1]?.hash);
        expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(row.keyVersion).toBeGreaterThanOrEqual(1);
        expect(['DONE', 'DENIED', 'FAILED']).toContain(row.outcome);
      });
    });

    it('fifty simultaneous requests leave a gap-free chain that verifies', async () => {
      const before = await headSeq();
      await Promise.all(Array.from({ length: 50 }, () => new Client({ ip: nextIp() }).get('/api/v1/notifications')));
      const rows = await events();
      expect(rows.length).toBeGreaterThanOrEqual(before + 50);
      rows.forEach((row, index) => {
        expect(row.seq).toBe(index + 1);
      });
      const result = verify();
      expect(result.status, result.output.slice(-2000)).toBe(0);
      // The verified head is written to the technical log (an anchor outside the
      // database); the run may append its own events.chain.verified after it.
      const heads = (await events()).slice(rows.length - 1).map((r) => r.hash);
      expect(
        heads.some((hash) => result.output.includes(hash)),
        'the verified head hash appears in the output of events:verify',
      ).toBe(true);
    });

    it('row 15: a row changed through the owner connection, triggers disabled then re-enabled, is reported', async () => {
      await generateEvents();
      const first = verify();
      expect(first.status, first.output.slice(-2000)).toBe(0);
      expect((await chainState()).chainStatus).toBe('OK');

      await generateEvents();
      const target = (await events()).filter((e) => e.outcome === 'DENIED').at(-1);
      expect(target).toBeDefined();
      await asOwnerWithoutTriggers(async (client) => {
        await client.query(`UPDATE "Event" SET outcome = 'DONE' WHERE seq = $1`, [target?.seq]);
      });

      const second = verify();
      expect(second.status, 'events:verify must fail on a tampered row').not.toBe(0);
      const state = await chainState();
      expect(state.chainStatus).toBe('BROKEN');
      expect(Number(state.brokenAtSeq)).toBe(target?.seq);
      expect((await events('events.chain.broken')).some((e) => e.details.brokenAtSeq === target?.seq)).toBe(true);
    });
  });

  describe('row 15: the key never enters the database', () => {
    it('row 15: recomputing the hashes without the key does not hide a changed row', async () => {
      await resetDatabase();
      await generateEvents(6);
      const rows = await events();
      const k = rows[Math.floor(rows.length / 2)]!.seq;
      const forgedKey = randomBytes(32);
      await asOwnerWithoutTriggers(async (client) => {
        let prev = rows.find((r) => r.seq === k - 1)?.hash ?? GENESIS_HASH;
        for (const row of rows.filter((r) => r.seq >= k)) {
          const record = row.seq === k ? { ...toRecord(row), outcome: 'DONE' as const } : toRecord(row);
          const hash = computeEventHash(forgedKey, prev, record);
          await client.query('UPDATE "Event" SET outcome = $2, "prevHash" = $3, hash = $4 WHERE seq = $1', [
            row.seq,
            record.outcome,
            prev,
            hash,
          ]);
          prev = hash;
        }
      });
      const result = verify();
      expect(result.status, 'events:verify must fail').not.toBe(0);
      const state = await chainState();
      expect(state.chainStatus).toBe('BROKEN');
      expect(Number(state.brokenAtSeq)).toBe(k);
    });

    it('row 15: deleting the last events after a verification is reported', async () => {
      await resetDatabase();
      await generateEvents(6);
      const anchored = verify();
      expect(anchored.status, anchored.output.slice(-2000)).toBe(0);
      const head = await headSeq();
      await asOwnerWithoutTriggers(async (client) => {
        await client.query('DELETE FROM "Event" WHERE seq > $1', [head - 2]);
      });
      const result = verify();
      expect(result.status, 'events:verify must fail when the head went backwards').not.toBe(0);
      expect((await chainState()).chainStatus).toBe('BROKEN');
    });
  });
});
