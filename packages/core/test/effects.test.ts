// Independent review IR-10 (decision 73): what an act declares in
// procedure/transitions.ts is checked against the snapshot rebuilt after it.
// effectViolations lists every declared effect that does not hold: a status
// other than the declared one (the same status when none is declared), a
// declared fact missing, a declared limit not opened or left without a
// statement, a limit the act closes still open. Written before the code.
// Review of the fix: a limit the act meets still open, a fact it clears
// still true.
import { describe, expect, it } from 'vitest';
import { ACTIONS, effectViolations, type CaseSnapshot, type ProcedureAction } from '../src/index';

const NOW = new Date('2027-03-15T09:30:00Z');
const PARTY = '11111111-1111-4111-8111-111111111111';

const base: CaseSnapshot = {
  caseFileId: '77777777-7777-4777-8777-777777777777',
  kind: 'FIRST_INSTANCE',
  status: 'REGISTERED',
  courtId: '22222222-2222-4222-8222-222222222222',
  panelId: null,
  administrativeCourt: false,
  rapporteurUserId: null,
  expertUserId: null,
  facts: [],
  parties: [{ partyId: PARTY, side: 'DEFENDANT', counselUserIds: [], litigantUserId: null, organizationId: null, facts: [] }],
  deadlines: [],
  nextSignerUserIds: [],
  minutesNextSignerUserIds: [],
  garnisheeOrganizationIds: [],
  summonsCodeHolderUserIds: [],
  cassationAccreditedUserIds: [],
};

function declared(code: string): ProcedureAction {
  const procedure = ACTIONS[code]?.procedure;
  if (!procedure) throw new Error(code);
  return procedure;
}

const later = new Date(NOW.getTime() + 10 * 86_400_000);
const earlier = new Date(NOW.getTime() - 86_400_000);

describe('the effects an act declares, checked on the snapshot after it (independent review IR-10)', () => {
  it('holds when the stamp’s fact is in the snapshot and the status has not moved', () => {
    const after: CaseSnapshot = { ...base, facts: ['REGISTRATION_STAMPED'] };
    expect(effectViolations(declared('case.registration.stamp'), base, after, [], NOW)).toEqual([]);
  });

  it('names a declared fact missing after the act', () => {
    expect(effectViolations(declared('case.registration.stamp'), base, base, [], NOW)).toEqual([{ kind: 'FACT', fact: 'REGISTRATION_STAMPED' }]);
  });

  it('names a status other than the declared next one, and a status that moved without a declaration', () => {
    const confirm = declared('case.rapporteur.confirm');
    expect(effectViolations(confirm, base, { ...base, status: 'RAPPORTEUR_ASSIGNED' }, [], NOW)).toEqual([]);
    expect(effectViolations(confirm, base, base, [], NOW)).toEqual([{ kind: 'STATUS', expected: 'RAPPORTEUR_ASSIGNED', actual: 'REGISTERED' }]);
    expect(effectViolations(declared('case.registration.note-to-judge'), base, { ...base, status: 'READY' }, [], NOW)).toEqual([
      { kind: 'STATUS', expected: 'REGISTERED', actual: 'READY' },
    ]);
  });

  it('names a declared limit with no statement, and a stated limit absent from the snapshot', () => {
    const cure = declared('case.order.cure-defects');
    const before: CaseSnapshot = { ...base, status: 'RAPPORTEUR_ASSIGNED' };
    expect(effectViolations(cure, before, before, [], NOW)).toEqual([{ kind: 'NOT_OPENED', code: 'CURE_DEFECTS', partyId: null }]);
    expect(effectViolations(cure, before, before, [{ code: 'CURE_DEFECTS', partyId: PARTY }], NOW)).toEqual([
      { kind: 'NOT_OPENED', code: 'CURE_DEFECTS', partyId: PARTY },
    ]);
    const after: CaseSnapshot = { ...before, deadlines: [{ code: 'CURE_DEFECTS', partyId: PARTY, endsAt: later, status: 'RUNNING' }] };
    expect(effectViolations(cure, before, after, [{ code: 'CURE_DEFECTS', partyId: PARTY }], NOW)).toEqual([]);
  });

  it('names a limit opened that the act does not declare', () => {
    expect(effectViolations(declared('case.registration.note-to-judge'), base, base, [{ code: 'APPEAL', partyId: PARTY }], NOW)).toEqual([
      { kind: 'NOT_DECLARED', code: 'APPEAL', partyId: PARTY },
    ]);
  });

  it('names a limit the act closes that is still open after it, and accepts one elapsed or closed', () => {
    const deposit: ProcedureAction = { ...declared('case.investigation.deposit'), closes: ['INVESTIGATION_DEPOSIT'] };
    const before: CaseSnapshot = { ...base, status: 'IN_EXPERTISE' };
    const open: CaseSnapshot = { ...before, deadlines: [{ code: 'INVESTIGATION_DEPOSIT', partyId: PARTY, endsAt: later, status: 'RUNNING' }] };
    expect(effectViolations(deposit, before, open, [], NOW)).toEqual([{ kind: 'NOT_CLOSED', code: 'INVESTIGATION_DEPOSIT', partyId: PARTY }]);
    const done: CaseSnapshot = {
      ...before,
      deadlines: [
        { code: 'INVESTIGATION_DEPOSIT', partyId: PARTY, endsAt: later, status: 'CLOSED' },
        { code: 'INVESTIGATION_DEPOSIT', partyId: PARTY, endsAt: earlier, status: 'RUNNING' },
      ],
    };
    expect(effectViolations(deposit, before, done, [], NOW)).toEqual([]);
  });

  // Review of the IR-10 fix: a limit met by the act it awaited is met, not closed, and a
  // stored fact stops being true only by a declared retraction.
  it('names a limit the act meets that is still open after it', () => {
    const deposit: ProcedureAction = { ...declared('case.investigation.deposit'), meets: ['INVESTIGATION_DEPOSIT'] };
    const before: CaseSnapshot = { ...base, status: 'IN_EXPERTISE' };
    const open: CaseSnapshot = { ...before, deadlines: [{ code: 'INVESTIGATION_DEPOSIT', partyId: PARTY, endsAt: later, status: 'RUNNING' }] };
    expect(effectViolations(deposit, before, open, [], NOW)).toEqual([{ kind: 'NOT_CLOSED', code: 'INVESTIGATION_DEPOSIT', partyId: PARTY }]);
    const met: CaseSnapshot = { ...before, deadlines: [{ code: 'INVESTIGATION_DEPOSIT', partyId: PARTY, endsAt: later, status: 'MET' }] };
    expect(effectViolations(deposit, before, met, [], NOW)).toEqual([]);
  });

  it('names a fact the act clears that is still true after it', () => {
    const report: ProcedureAction = { ...declared('case.expert.deposit-report'), clears: ['INVESTIGATION_ONGOING'] };
    const before: CaseSnapshot = { ...base, status: 'IN_EXPERTISE', facts: ['INVESTIGATION_ONGOING', 'EXPERT_PARTIES_SUMMONED'] };
    const kept: CaseSnapshot = { ...before, status: 'IN_PREPARATION' };
    expect(effectViolations(report, before, kept, [], NOW)).toEqual([{ kind: 'NOT_CLEARED', fact: 'INVESTIGATION_ONGOING' }]);
    const cleared: CaseSnapshot = { ...before, status: 'IN_PREPARATION', facts: ['EXPERT_PARTIES_SUMMONED'] };
    expect(effectViolations(report, before, cleared, [], NOW)).toEqual([]);
  });

  it('declares no act that sets and clears the same fact, or meets and closes the same limit', () => {
    for (const rule of Object.values(ACTIONS)) {
      const action = rule?.procedure;
      if (!action) continue;
      expect(action.sets.filter((f) => action.clears.includes(f)), action.code).toEqual([]);
      expect(action.meets.filter((c) => action.closes.includes(c)), action.code).toEqual([]);
    }
  });
});
