// What an act declares in the table (transitions.ts: its next status, the facts
// it sets and clears, the time limits it opens, meets and closes), checked
// against the snapshot of the file rebuilt after it (independent review IR-10,
// decision 73). The server's
// applier carries the declaration out inside the act's transaction, then asks
// this function; any violation fails the transaction. Pure: the snapshots, the
// limits the act opened and the instant are given.
import { deadlineState } from './conditions';
import type { CaseFact, CaseSnapshot, DeadlineCode } from './snapshot';
import type { CaseStatus } from './states';
import type { ProcedureAction } from './transitions';

/** A limit the act opened, as its executor stated it: the party it runs against, or null for the file. */
export interface OpenedLimit {
  readonly code: DeadlineCode;
  readonly partyId: string | null;
}

export type EffectViolation =
  /** the status after the act is not the declared next one (the same status when none is declared) */
  | { readonly kind: 'STATUS'; readonly expected: CaseStatus; readonly actual: CaseStatus }
  /** a fact the act declares is not true after it */
  | { readonly kind: 'FACT'; readonly fact: CaseFact }
  /** a fact the act declares it ends is still true after it */
  | { readonly kind: 'NOT_CLEARED'; readonly fact: CaseFact }
  /** a limit the act declares was not opened (stated by nobody, or absent from the snapshot) */
  | { readonly kind: 'NOT_OPENED'; readonly code: DeadlineCode; readonly partyId: string | null }
  /** a limit was opened that the act does not declare */
  | { readonly kind: 'NOT_DECLARED'; readonly code: DeadlineCode; readonly partyId: string | null }
  /** a limit the act meets or closes is still open after it */
  | { readonly kind: 'NOT_CLOSED'; readonly code: DeadlineCode; readonly partyId: string | null };

export function effectViolations(
  action: ProcedureAction,
  before: CaseSnapshot,
  after: CaseSnapshot,
  opened: readonly OpenedLimit[],
  now: Date,
): EffectViolation[] {
  const out: EffectViolation[] = [];
  const expected = action.nextStatus ?? before.status;
  if (after.status !== expected) out.push({ kind: 'STATUS', expected, actual: after.status });
  for (const fact of action.sets) if (!after.facts.includes(fact)) out.push({ kind: 'FACT', fact });
  for (const fact of action.clears) if (after.facts.includes(fact)) out.push({ kind: 'NOT_CLEARED', fact });

  for (const code of action.opens) {
    if (!opened.some((o) => o.code === code)) out.push({ kind: 'NOT_OPENED', code, partyId: null });
  }
  for (const limit of opened) {
    if (!action.opens.includes(limit.code)) {
      out.push({ kind: 'NOT_DECLARED', code: limit.code, partyId: limit.partyId });
      continue;
    }
    if (!after.deadlines.some((d) => d.code === limit.code && d.partyId === limit.partyId)) {
      out.push({ kind: 'NOT_OPENED', code: limit.code, partyId: limit.partyId });
    }
  }

  // What the act meets or closes is open no more, save what it opened itself.
  for (const code of [...action.meets, ...action.closes]) {
    const reopened = opened.filter((o) => o.code === code);
    const stillOpen = after.deadlines.filter((d) => d.code === code && deadlineState([d], code, d.partyId, now) === 'OPEN');
    for (const deadline of stillOpen.slice(reopened.length)) out.push({ kind: 'NOT_CLOSED', code, partyId: deadline.partyId });
  }
  return out;
}
