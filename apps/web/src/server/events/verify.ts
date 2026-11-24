import 'server-only';
import { verifyChain, type ChainedEventRecord, type ChainVerification, type LegalBasis } from '@mahkama/core';
import type { Event } from '@/generated/prisma/client';
import { clock } from '../clock';
import { getDb } from '../db';
import { log } from '../log';
import { appendStandaloneEvent } from './append';
import { chainKeyring } from './keyring';

// Verification of the event chain (contract §5). Incremental from the last
// anchored head (kept in SystemState and written to the technical log, which is
// outside the database), with a full pass at least once a day. A broken chain
// sets SystemState.chainStatus = BROKEN, shown to the system administrator, and
// is reported at error level on every run until a logged action clears it.

const PAGE = 1000;
const FULL_PASS_EVERY_MS = 24 * 60 * 60 * 1000;

function toRecord(row: Event): ChainedEventRecord {
  return {
    seq: Number(row.seq),
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    actorUserId: row.actorUserId,
    actorRoleAssignmentId: row.actorRoleAssignmentId,
    actorRole: row.actorRole,
    viaDemoSwitch: row.viaDemoSwitch,
    clientIdHash: row.clientIdHash,
    action: row.action,
    outcome: row.outcome as ChainedEventRecord['outcome'],
    caseFileId: row.caseFileId,
    legalBasis: (row.legalBasis ?? null) as LegalBasis | null,
    details: row.details as ChainedEventRecord['details'],
    keyVersion: row.keyVersion,
    prevHash: row.prevHash,
    hash: row.hash,
  };
}

async function* rowsFrom(fromSeq: number): AsyncGenerator<ChainedEventRecord> {
  let next = BigInt(fromSeq);
  for (;;) {
    const page = await getDb().event.findMany({ where: { seq: { gte: next } }, orderBy: { seq: 'asc' }, take: PAGE });
    for (const row of page) yield toRecord(row);
    if (page.length < PAGE) return;
    const last = page.at(-1);
    if (!last) return;
    next = last.seq + 1n;
  }
}

async function collect(fromSeq: number): Promise<ChainedEventRecord[]> {
  const rows: ChainedEventRecord[] = [];
  for await (const row of rowsFrom(fromSeq)) rows.push(row);
  return rows;
}

export interface VerificationReport {
  readonly result: ChainVerification;
  readonly mode: 'INCREMENTAL' | 'FULL';
}

export async function verifyEventChain(options: { full?: boolean } = {}): Promise<VerificationReport> {
  const db = getDb();
  const state = await db.systemState.findUnique({ where: { id: 1 } });
  const due = !state?.lastFullVerifiedAt || clock.now().getTime() - state.lastFullVerifiedAt.getTime() > FULL_PASS_EVERY_MS;
  const full = options.full === true || due || state.chainHeadSeq == null;
  const anchor =
    !full && state.chainHeadSeq != null && state.chainHeadHash
      ? { seq: Number(state.chainHeadSeq), hash: state.chainHeadHash }
      : undefined;

  // The full pass also checks the stored anchor: the anchored row must still exist unchanged.
  const rows = await collect(anchor ? anchor.seq : 1);
  let result = verifyChain(chainKeyring, rows, anchor ? { anchor } : {});
  if (result.ok && full && state?.chainHeadSeq != null && state.chainHeadHash) {
    const anchored = rows.find((r) => r.seq === Number(state.chainHeadSeq));
    if (!anchored) result = { ok: false, brokenAtSeq: Number(state.chainHeadSeq), reason: 'HEAD_BEHIND_ANCHOR' };
    else if (anchored.hash !== state.chainHeadHash) result = { ok: false, brokenAtSeq: anchored.seq, reason: 'ANCHOR_MISMATCH' };
  }

  const mode = full ? 'FULL' : 'INCREMENTAL';
  const now = clock.now();
  if (result.ok) {
    const head = result.head ?? (anchor ? { seq: anchor.seq, hash: anchor.hash } : null);
    if (state?.chainStatus === 'BROKEN') {
      // A broken chain stays broken until cleared by a logged administrative action.
      log.error('event chain still marked broken', { brokenAtSeq: state.brokenAtSeq === null ? null : Number(state.brokenAtSeq) });
      return { result: { ok: false, brokenAtSeq: Number(state.brokenAtSeq ?? 0), reason: 'HASH_MISMATCH' }, mode };
    }
    await db.systemState.update({
      where: { id: 1 },
      data: {
        chainStatus: 'OK',
        chainHeadSeq: head ? BigInt(head.seq) : null,
        chainHeadHash: head?.hash ?? null,
        lastVerifiedAt: now,
        ...(full ? { lastFullVerifiedAt: now } : {}),
      },
    });
    // Anchor outside the database.
    log.info('event chain verified', { mode, headSeq: head?.seq ?? 0, headHash: head?.hash ?? null });
    if (head) await appendStandaloneEvent({ action: 'events.chain.verified', details: { headSeq: head.seq, mode } });
  } else {
    await db.systemState.update({
      where: { id: 1 },
      data: { chainStatus: 'BROKEN', brokenAtSeq: BigInt(result.brokenAtSeq), lastVerifiedAt: now },
    });
    log.error('event chain broken', { mode, brokenAtSeq: result.brokenAtSeq, reason: result.reason });
    await appendStandaloneEvent({
      action: 'events.chain.broken',
      details: { brokenAtSeq: result.brokenAtSeq, reason: result.reason },
    });
  }
  return { result, mode };
}
