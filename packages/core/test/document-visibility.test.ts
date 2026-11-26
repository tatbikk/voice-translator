// Independent review IR-06 (decision 71), written before the code: the
// application uploaded as a Word document stays in the file exactly as filed,
// with its tracked changes, comments and author, but only its depositor and the
// judges and staff of the file's court may see or download it. The prosecution,
// the royal commissioner, the other counsel and the litigants may not, even
// when the file is open to them: they read the fixed copy, the one served on
// the opponent. The single authorization function decides it, on the document's
// visibility and its depositor.
import { describe, expect, it } from 'vitest';
import { authorize, documentVisible, type AuthorizationContext, type CaseSnapshot, type Resource, type RoleCode, type UserSubject } from '../src/index';

const NOW = new Date('2027-03-15T09:30:00Z');
const context: AuthorizationContext = { mode: 'demo', demoToolsEnabled: false, now: NOW };

const COURT = '10000000-0000-4000-8000-000000000001';
const OTHER_COURT = '10000000-0000-4000-8000-000000000002';
const PANEL = '20000000-0000-4000-8000-000000000001';
const ORGANIZATION = '30000000-0000-4000-8000-000000000001';
const DEPOSITOR = '40000000-0000-4000-8000-000000000001';
const CO_COUNSEL = '40000000-0000-4000-8000-000000000002';
const DEFENCE_COUNSEL = '40000000-0000-4000-8000-000000000003';
const FORMER_COUNSEL = '40000000-0000-4000-8000-000000000004';
const RAPPORTEUR = '40000000-0000-4000-8000-000000000005';
const LITIGANT = '40000000-0000-4000-8000-000000000006';
const EXPERT = '40000000-0000-4000-8000-000000000007';
const SOMEONE = '40000000-0000-4000-8000-000000000008';
const ORIGINAL = '50000000-0000-4000-8000-000000000001';
const FIXED_COPY = '50000000-0000-4000-8000-000000000002';

/** A file of an administrative court, referred to the prosecution and to the royal commissioner, in preparation. */
const snapshot: CaseSnapshot = {
  caseFileId: '60000000-0000-4000-8000-000000000001',
  kind: 'FIRST_INSTANCE',
  status: 'IN_PREPARATION',
  courtId: COURT,
  panelId: PANEL,
  administrativeCourt: true,
  rapporteurUserId: RAPPORTEUR,
  expertUserId: EXPERT,
  facts: ['REFERRED_TO_PROSECUTION', 'REFERRED_TO_COMMISSIONER'],
  parties: [
    { partyId: '70000000-0000-4000-8000-000000000001', side: 'PLAINTIFF', counselUserIds: [DEPOSITOR, CO_COUNSEL], litigantUserId: null, organizationId: null, facts: [] },
    { partyId: '70000000-0000-4000-8000-000000000002', side: 'DEFENDANT', counselUserIds: [DEFENCE_COUNSEL], litigantUserId: null, organizationId: ORGANIZATION, facts: [] },
    { partyId: '70000000-0000-4000-8000-000000000003', side: 'GUARANTOR', counselUserIds: [], litigantUserId: LITIGANT, organizationId: null, facts: ['E_SERVICE_ACCEPTED'] },
  ],
  deadlines: [],
  nextSignerUserIds: [],
  minutesNextSignerUserIds: [],
  garnisheeOrganizationIds: [],
  summonsCodeHolderUserIds: [],
  cassationAccreditedUserIds: [],
};

function holder(role: RoleCode, userId: string = SOMEONE, options: { courtId?: string | null; panelId?: string | null; organizationId?: string | null } = {}): UserSubject {
  return {
    kind: 'user',
    userId,
    role,
    roleAssignmentId: '80000000-0000-4000-8000-000000000001',
    courtId: options.courtId === undefined ? COURT : options.courtId,
    panelId: options.panelId ?? null,
    organizationId: options.organizationId ?? null,
    isDemoAccount: true,
    roleCount: 1,
    verificationStatus: 'VERIFIED_SIMULATED',
  };
}

const original = (depositorUserId: string | null = DEPOSITOR): Resource => ({
  kind: 'case-document',
  snapshot,
  visibility: 'DEPOSITOR_AND_COURT',
  documentId: ORIGINAL,
  depositorUserId,
});
const fixedCopy: Resource = { kind: 'case-document', snapshot, visibility: 'CASE', documentId: FIXED_COPY, depositorUserId: DEPOSITOR };

const read = (subject: UserSubject, resource: Resource) => authorize(subject, 'case.document.read', resource, context);

const COURT_SIDE: readonly [string, UserSubject][] = [
  ['the rapporteur judge', holder('JUDGE_RAPPORTEUR', RAPPORTEUR, { panelId: PANEL })],
  ['the president of the file’s panel', holder('PANEL_PRESIDENT', SOMEONE, { panelId: PANEL })],
  ['a member of the file’s panel', holder('PANEL_MEMBER', SOMEONE, { panelId: PANEL })],
  ['the court president', holder('COURT_PRESIDENT')],
  ['the enforcement judge of the court', holder('ENFORCEMENT_JUDGE')],
  ['the registry clerk of the court', holder('CLERK_REGISTRATION')],
  ['the cashier of the court', holder('CLERK_CASHIER')],
  ['the notification clerk of the court', holder('CLERK_NOTIFICATION')],
  ['the hearing clerk of the court', holder('CLERK_HEARING')],
  ['the copies and enforcement clerk of the court', holder('CLERK_COPIES_ENFORCEMENT')],
  ['the chief clerk of the court', holder('CHIEF_CLERK')],
];

const KEPT_FROM: readonly [string, UserSubject][] = [
  ['the prosecution of the court, the file referred to it', holder('PUBLIC_PROSECUTOR')],
  ['the royal commissioner of the court, the file referred to him', holder('ROYAL_COMMISSIONER')],
  ['another counsel of the same plaintiff', holder('LAWYER', CO_COUNSEL, { courtId: null })],
  ['the counsel of the defendant', holder('LAWYER', DEFENCE_COUNSEL, { courtId: null })],
  ['a litigant of the file who accepted electronic service', holder('LITIGANT', LITIGANT, { courtId: null })],
  ['the administration that is a party', holder('PUBLIC_ADMIN_LITIGATION', SOMEONE, { courtId: null, organizationId: ORGANIZATION })],
];

describe('the application as uploaded in Word: its depositor and the court only (independent review IR-06, decision 71)', () => {
  it('is served to the lawyer who deposited it', () => {
    const depositor = holder('LAWYER', DEPOSITOR, { courtId: null });
    expect(documentVisible(depositor, snapshot, 'DEPOSITOR_AND_COURT', ORIGINAL, DEPOSITOR)).toBe(true);
    expect(read(depositor, original())).toMatchObject({ allowed: true });
  });

  for (const [who, subject] of COURT_SIDE) {
    it(`is served to ${who}`, () => {
      expect(documentVisible(subject, snapshot, 'DEPOSITOR_AND_COURT', ORIGINAL, DEPOSITOR)).toBe(true);
      expect(read(subject, original())).toMatchObject({ allowed: true });
    });
  }

  for (const [who, subject] of KEPT_FROM) {
    it(`does not exist for ${who}, who reads the fixed copy`, () => {
      expect(documentVisible(subject, snapshot, 'DEPOSITOR_AND_COURT', ORIGINAL, DEPOSITOR)).toBe(false);
      expect(read(subject, original())).toEqual({ allowed: false, reason: 'NOT_FOUND' });
      // The file itself stays open to them, and the copy served on the opponent with it.
      expect(documentVisible(subject, snapshot, 'CASE', FIXED_COPY, DEPOSITOR)).toBe(true);
      expect(read(subject, fixedCopy)).toMatchObject({ allowed: true });
    });
  }

  it('is the depositor’s as a person, not his party’s: another counsel of the same party does not read it', () => {
    const coCounsel = holder('LAWYER', CO_COUNSEL, { courtId: null });
    expect(read(coCounsel, original(CO_COUNSEL))).toMatchObject({ allowed: true });
    expect(read(coCounsel, original(DEPOSITOR))).toEqual({ allowed: false, reason: 'NOT_FOUND' });
  });

  it('is the court’s alone when it names no depositor', () => {
    expect(read(holder('LAWYER', DEPOSITOR, { courtId: null }), original(null))).toEqual({ allowed: false, reason: 'NOT_FOUND' });
    expect(read(holder('CLERK_REGISTRATION'), original(null))).toMatchObject({ allowed: true });
  });

  it('gives nothing to a depositor who no longer acts in the file, nor to the staff of another court', () => {
    expect(read(holder('LAWYER', FORMER_COUNSEL, { courtId: null }), original(FORMER_COUNSEL))).toEqual({ allowed: false, reason: 'NOT_FOUND' });
    expect(read(holder('CLERK_REGISTRATION', SOMEONE, { courtId: OTHER_COURT }), original())).toEqual({ allowed: false, reason: 'NOT_FOUND' });
    expect(read(holder('COURT_PRESIDENT', SOMEONE, { courtId: OTHER_COURT }), original())).toEqual({ allowed: false, reason: 'NOT_FOUND' });
  });

  it('gives nothing to the expert of the file, nor to the system administration', () => {
    expect(read(holder('EXPERT', EXPERT, { courtId: null }), original())).toEqual({ allowed: false, reason: 'NOT_FOUND' });
    expect(read(holder('SYSTEM_ADMIN', SOMEONE), original())).toEqual({ allowed: false, reason: 'NOT_FOUND' });
  });

  it('leaves the other visibilities as they were: the panel’s documents to the panel, the judge’s to the rapporteur', () => {
    expect(documentVisible(holder('CLERK_REGISTRATION'), snapshot, 'PANEL', ORIGINAL, null)).toBe(false);
    expect(documentVisible(holder('PANEL_MEMBER', SOMEONE, { panelId: PANEL }), snapshot, 'PANEL', ORIGINAL, null)).toBe(true);
    expect(documentVisible(holder('PANEL_MEMBER', SOMEONE, { panelId: PANEL }), snapshot, 'JUDGE', ORIGINAL, null)).toBe(false);
    expect(documentVisible(holder('JUDGE_RAPPORTEUR', RAPPORTEUR, { panelId: PANEL }), snapshot, 'JUDGE', ORIGINAL, null)).toBe(true);
    // A depositor gains nothing from depositing a document of the panel or of the judge.
    expect(documentVisible(holder('LAWYER', DEPOSITOR, { courtId: null }), snapshot, 'PANEL', ORIGINAL, DEPOSITOR)).toBe(false);
    expect(documentVisible(holder('LAWYER', DEPOSITOR, { courtId: null }), snapshot, 'JUDGE', ORIGINAL, DEPOSITOR)).toBe(false);
  });
});
