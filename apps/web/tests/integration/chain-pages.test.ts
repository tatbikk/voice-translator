// Review A-08 / S-07: the chain is verified page by page, so that memory does
// not grow with the log. Small pages make the page boundaries visible: a full
// pass counts every row, and a row changed inside a page or on the boundary
// between two pages is reported at its own sequence number.
import { describe, expect, it } from 'vitest';
import { appendStandaloneEvent } from '@/server/events/append';
import { verifyEventChain } from '@/server/events/verify';
import { count, ownerClient } from '../helpers/db';
import { useFreshDatabase } from '../helpers/reset';

async function tamper(seq: number): Promise<void> {
  const client = await ownerClient();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE "Event" DISABLE TRIGGER USER');
    await client.query(`UPDATE "Event" SET details = '{"scope":"global"}'::jsonb WHERE seq = $1`, [seq]);
    await client.query('ALTER TABLE "Event" ENABLE TRIGGER USER');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

describe('event chain verified page by page (review A-08)', () => {
  useFreshDatabase();

  it('a full pass over several pages counts every row and anchors the last one', async () => {
    for (let i = 0; i < 40; i += 1) await appendStandaloneEvent({ action: 'access.code.accepted', details: {} });
    const total = await count('SELECT count(*) AS n FROM "Event"');
    const report = await verifyEventChain({ full: true, pageSize: 7 });
    expect(report.result.ok, JSON.stringify(report.result)).toBe(true);
    if (report.result.ok) {
      expect(report.result.count).toBe(total);
      expect(report.result.head?.seq).toBe(total);
    }
  });

  it('an incremental pass from the stored head also crosses pages', async () => {
    for (let i = 0; i < 20; i += 1) await appendStandaloneEvent({ action: 'access.code.accepted', details: {} });
    const report = await verifyEventChain({ pageSize: 5 });
    expect(report.mode).toBe('INCREMENTAL');
    expect(report.result.ok, JSON.stringify(report.result)).toBe(true);
  });

  it('a row changed on the boundary between two pages is reported at its own sequence number', async () => {
    // With pages of 7 rows, row 14 is the last row of the second page and the
    // anchor of the third.
    await tamper(14);
    const report = await verifyEventChain({ full: true, pageSize: 7 });
    expect(report.result).toMatchObject({ ok: false, brokenAtSeq: 14 });
  });
});
