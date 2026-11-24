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

type Anchor = { readonly seq: number; readonly hash: string };

/**
 * Verifies the chain page by page: memory does not grow with the log (review
 * A-08). Each page is verified from the last row of the previous one, which is
 * its anchor, so that the link between pages is checked too. `mustContain` is
 * the stored head of a full pass: that row must still be there, unchanged.
 */
async function verifyInPages(
  fromSeq: number,
  anchor: Anchor | undefined,
  mustContain: Anchor | null,
  pageSize: number,
): Promise<ChainVerification> {
  let carry: ChainedEventRecord | null = null;
  let count = 0;
  let head: Anchor | null = null;
  let sawStoredHead = mustContain === null;
  let next = BigInt(fromSeq);
  for (;;) {
    const page = (await getDb().event.findMany({ where: { seq: { gte: next } }, orderBy: { seq: 'asc' }, take: pageSize })).map(toRecord);
    if (page.length === 0) break;
    const rows = carry ? [carry, ...page] : page;
    const pageAnchor = carry ? { seq: carry.seq, hash: carry.hash } : anchor;
    const result = verifyChain(chainKeyring, rows, pageAnchor ? { anchor: pageAnchor } : {});
    if (!result.ok) return result;
    if (mustContain && !sawStoredHead) {
      const stored = page.find((r) => r.seq === mustContain.seq);
      if (stored) {
        if (stored.hash !== mustContain.hash) return { ok: false, brokenAtSeq: stored.seq, reason: 'ANCHOR_MISMATCH' };
        sawStoredHead = true;
      }
    }
    count += carry ? result.count - 1 : result.count;
    head = result.head;
    const last = page.at(-1);
    if (!last || page.length < pageSize) break;
    carry = last;
    next = BigInt(last.seq) + 1n;
  }
  if (mustContain && !sawStoredHead) return { ok: false, brokenAtSeq: mustContain.seq, reason: 'HEAD_BEHIND_ANCHOR' };
  // Anchored, and not even the anchored row is left.
  if (anchor && head === null) return { ok: false, brokenAtSeq: anchor.seq, reason: 'HEAD_BEHIND_ANCHOR' };
  return { ok: true, count, head };
}

export interface VerificationReport {
  readonly result: ChainVerification;
  readonly mode: 'INCREMENTAL' | 'FULL';
}

export async function verifyEventChain(options: { full?: boolean; pageSize?: number } = {}): Promise<VerificationReport> {
  const db = getDb();
  const state = await db.systemState.findUnique({ where: { id: 1 } });
  const due = !state?.lastFullVerifiedAt || clock.now().getTime() - state.lastFullVerifiedAt.getTime() > FULL_PASS_EVERY_MS;
  const full = options.full === true || due || state.chainHeadSeq == null;
  const anchor =
    !full && state.chainHeadSeq != null && state.chainHeadHash
      ? { seq: Number(state.chainHeadSeq), hash: state.chainHeadHash }
      : undefined;

  // The full pass also checks the stored anchor: the anchored row must still exist unchanged.
  const storedHead =
    full && state?.chainHeadSeq != null && state.chainHeadHash ? { seq: Number(state.chainHeadSeq), hash: state.chainHeadHash } : null;
  const result = await verifyInPages(anchor ? anchor.seq : 1, anchor, storedHead, options.pageSize ?? PAGE);

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
