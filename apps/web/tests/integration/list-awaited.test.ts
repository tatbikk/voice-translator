// Review of the IR-11 fix, written before the code: «ينتظر إجراء مني» counts
// and pages only the files in which an act awaits the user, the one waiting
// longest first, because the query reads every condition of the act from the
// file's data (the latest investigation, the hearing on the platform's day,
// the parties' facts and time limits, the judgment's signature circle), not
// only the conditions a column of the file holds. Each list seeds more files
// in the act's state where nothing awaits than a page holds, older than the
// file where the act awaits, as the reviewer reproduced it:
//   - the cashier: files in preparation without fees ordered, one with fees
//     ordered and not paid, one whose fees were ordered on an earlier
//     investigation only;
//   - the judge rapporteur: files under expertise where nothing is lapsed,
//     one where the deposit lapsed, one whose expert declined, one whose
//     earlier expert declined, and one waiting for its hearing to be set;
//   - the panel president: files ready with a hearing tomorrow or yesterday,
//     one with its hearing in session today, a judgment whose circle waits
//     for his signature, one where it waits for another signer, one to be
//     pronounced today and one tomorrow;
//   - the hearing clerk: a hearing held, a judgment to serve in the hearing,
//     a circle waiting for his signature; nothing waits for a signature of
//     the minutes, which no file says is his;
//   - the lawyer: a deposit due within its time limit, a deposit authorized,
//     and files where it lapsed, is due from another party, or was made.
// With two courts, no list counts a file of the other court, even through a
// scope whose relations the query alone cannot bound; and the files every
// page shows are, file for file, those in which the core grants an awaited
// act. Last, the latest investigation is the one the database marks, and
// only one is marked per file.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { actionScope, addDays, authorize, availableActions, awaitedScope, moroccoDay, startOfMoroccoDay, type UserSubject } from '@mahkama/core';
import { getDb } from '@/server/db';
import * as scope from '@/server/cases/scope';
import { caseSnapshot } from '@/server/cases/snapshot';
import { dashboardFor, type WaitingItem } from '@/server/dashboard/service';
import { PAGE_SIZE, type Page } from '@/server/lists/paging';
import { one, runtime, sql } from '../helpers/db';
import { createCaseFile, createCourt, createPanel, createUser, type CourtFixture, type TestUser } from '../helpers/factories';
import { useFreshDatabase } from '../helpers/reset';

useFreshDatabase();

const NOW = new Date();
const DAY = 86_400_000;
const TODAY = moroccoDay(NOW);
const DAY_START = startOfMoroccoDay(TODAY);
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY);
const context = () => ({ mode: 'demo' as const, demoToolsEnabled: false, now: NOW });
const NOISE = PAGE_SIZE.awaiting + 2;

let courtA: CourtFixture;
let courtB: CourtFixture;
let panelA: string;
let panelB: string;
const users = {} as Record<'cashierA' | 'cashierB' | 'judgeA' | 'presidentA' | 'clerkA' | 'clerkB' | 'lawyerA', TestUser>;

/** The files where an act awaits, by subject, the oldest first, and the act expected first on each. */
const awaited = {
  cashierA: [] as [string, string][],
  cashierB: [] as [string, string][],
  judgeA: [] as [string, string][],
  presidentA: [] as [string, string][],
  clerkA: [] as [string, string][],
  clerkB: [] as [string, string][],
  lawyerA: [] as [string, string][],
};
const seeded = { judgeSignOther: '', presidentSignLater: '', courtBMinutes: '', twoInvestigations: '', declinedBefore: '' };

const label = (code: string) => `actions.${code}.label`;

async function subjectOf(user: TestUser): Promise<UserSubject> {
  const row = await one<{ role: UserSubject['role']; courtId: string | null; panelId: string | null; organizationId: string | null }>(
    `SELECT role, "courtId", "panelId", "organizationId" FROM "RoleAssignment" WHERE id = $1`,
    [user.roleAssignmentId],
  );
  return {
    kind: 'user',
    userId: user.id,
    role: row.role,
    roleAssignmentId: user.roleAssignmentId,
    courtId: row.courtId,
    panelId: row.panelId,
    organizationId: row.organizationId,
    isDemoAccount: false,
    roleCount: 1,
    verificationStatus: 'VERIFIED_SIMULATED',
  };
}

interface FileOptions {
  readonly at: Date;
  readonly status: string;
  readonly rapporteur?: TestUser;
  readonly panel?: string;
  readonly facts?: readonly string[];
  readonly pronouncementDate?: string;
}

/** A file registered and stamped on the given day. */
async function file(court: CourtFixture, options: FileOptions): Promise<string> {
  const created = await createCaseFile({ courtId: court.id, status: options.status });
  await sql(
    `UPDATE "CaseFile" SET "registeredAt" = $2, "createdAt" = $2, "registrationStampedAt" = $2, "rapporteurUserId" = $3, "panelId" = $4,
       facts = $5::text[], "pronouncementDate" = $6
     WHERE id = $1`,
    [created.id, options.at, options.rapporteur?.id ?? null, options.panel ?? null, options.facts ?? [], options.pronouncementDate ?? null],
  );
  return created.id;
}

async function hearing(caseFileId: string, court: CourtFixture, panelId: string, startsAt: Date, heldAt: Date | null = null): Promise<void> {
  const id = randomUUID();
  await sql(`INSERT INTO "Hearing" (id, "courtId", "panelId", room, "startsAt", "isDemo", "heldAt") VALUES ($1, $2, $3, 'القاعة 1', $4, true, $5)`, [
    id,
    court.id,
    panelId,
    startsAt,
    heldAt,
  ]);
  await sql(`UPDATE "CaseFile" SET "nextHearingId" = $2 WHERE id = $1`, [caseFileId, id]);
}

async function party(caseFileId: string, options: { side?: string; facts?: readonly string[]; lawyer?: TestUser } = {}): Promise<string> {
  const id = randomUUID();
  await sql(
    `INSERT INTO "CaseParty" (id, "caseFileId", side, "personKind", "displayName", position, facts) VALUES ($1, $2, $3::"PartySide", 'LEGAL', 'شركة الاختبار', 1, $4::text[])`,
    [id, caseFileId, options.side ?? 'PLAINTIFF', options.facts ?? []],
  );
  if (options.lawyer) {
    await sql(`INSERT INTO "Representation" (id, "partyId", "lawyerUserId", "startedAt") VALUES ($1, $2, $3, now())`, [randomUUID(), id, options.lawyer.id]);
  }
  return id;
}

async function limit(caseFileId: string, partyId: string | null, ruleCode: string, endsAt: Date, status = 'RUNNING'): Promise<void> {
  await sql(
    `INSERT INTO "TimeLimit" (id, "caseFileId", "ruleCode", "ruleSetId", "partyId", "startsAt", "endsAt", "lastDay", status, computation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::"TimeLimitStatus", '{}'::jsonb)`,
    [randomUUID(), caseFileId, ruleCode, randomUUID(), partyId, daysAgo(30), endsAt, moroccoDay(endsAt), status],
  );
}

interface InvestigationColumns {
  readonly createdAt: Date;
  readonly depositedAt?: Date;
  readonly declinedAt?: Date;
  readonly feesOrderedCents?: number;
  readonly feesPaidAt?: Date;
}

async function investigation(caseFileId: string, columns: InvestigationColumns): Promise<string> {
  const id = randomUUID();
  await sql(
    `INSERT INTO "Investigation" (id, "caseFileId", kind, "depositedAt", "declinedAt", "feesOrderedCents", "feesPaidAt", "createdAt")
     VALUES ($1, $2, 'EXPERTISE', $3, $4, $5, $6, $7)`,
    [id, caseFileId, columns.depositedAt ?? null, columns.declinedAt ?? null, columns.feesOrderedCents ?? null, columns.feesPaidAt ?? null, columns.createdAt],
  );
  return id;
}

/** The judgment of the file, with its signature circle: the signers in order, and how many signed. */
async function judgment(caseFileId: string, signers: readonly TestUser[], signed: number, status: 'OPEN' | 'COMPLETED'): Promise<void> {
  const documentId = randomUUID();
  const sha = 'b'.repeat(64);
  await sql(
    `INSERT INTO "Document" (id, "caseFileId", "storageKey", sha256, "byteSize", "mediaType", "docType", channel, "depositedAt", generated, visibility)
     VALUES ($1, $2, $3, $4, 1, 'application/pdf', 'JUDGMENT', 'ELECTRONIC', now(), true, 'PANEL')`,
    [documentId, caseFileId, `judgment-${documentId}`, sha],
  );
  const circleId = randomUUID();
  const list = await Promise.all(signers.map(async (u) => ({ userId: u.id, roleAssignmentId: u.roleAssignmentId, role: (await subjectOf(u)).role })));
  await sql(
    `INSERT INTO "SignatureCircle" (id, "documentId", purpose, signers, "documentSha256", status, "openedAt") VALUES ($1, $2, 'JUDGMENT', $3::jsonb, $4, $5::"CircleStatus", now())`,
    [circleId, documentId, JSON.stringify(list), sha, status],
  );
  for (let position = 0; position < signed; position += 1) {
    const signer = list[position];
    if (!signer) throw new Error('no signer at this position');
    await sql(
      `INSERT INTO "Signature" (id, "circleId", position, "signerUserId", "signerRoleAssignmentId", "signerRole", "documentSha256", "signedAt", provider, "providerRef")
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), 'SIMULATED', $8)`,
      [randomUUID(), circleId, position, signer.userId, signer.roleAssignmentId, signer.role, sha, `ref-${String(position)}`],
    );
  }
  await sql(
    `INSERT INTO "Decision" (id, "caseFileId", kind, "subjectCode", "documentId", "signatureCircleId", "issuedAt") VALUES ($1, $2, 'JUDGMENT', 'MERITS', $3, $4, now())`,
    [randomUUID(), caseFileId, documentId, circleId],
  );
}

/** Every page of «ينتظر إجراء مني», read one after the other. */
async function allPages(subject: UserSubject): Promise<Page<WaitingItem>[]> {
  const pages: Page<WaitingItem>[] = [];
  for (let page = 1; page < 50; page += 1) {
    const current = (await dashboardFor(subject, null, context(), { awaiting: page, deadlines: 1 })).waiting;
    pages.push(current);
    if (current.to >= current.total) return pages;
  }
  throw new Error('more than 50 pages');
}

const filesOf = (rows: readonly WaitingItem[]) => [...new Set(rows.map((r) => r.caseFileId))];

beforeAll(async () => {
  courtA = await createCourt();
  courtB = await createCourt();
  panelA = await createPanel(courtA.id);
  panelB = await createPanel(courtB.id);
  users.cashierA = await createUser({ roles: [{ role: 'CLERK_CASHIER', courtId: courtA.id }], label: 'cashier-a' });
  users.cashierB = await createUser({ roles: [{ role: 'CLERK_CASHIER', courtId: courtB.id }], label: 'cashier-b' });
  users.judgeA = await createUser({ roles: [{ role: 'JUDGE_RAPPORTEUR', courtId: courtA.id }], label: 'judge-a' });
  users.presidentA = await createUser({ roles: [{ role: 'PANEL_PRESIDENT', courtId: courtA.id }], label: 'president-a' });
  users.clerkA = await createUser({ roles: [{ role: 'CLERK_HEARING', courtId: courtA.id }], label: 'clerk-a' });
  users.clerkB = await createUser({ roles: [{ role: 'CLERK_HEARING', courtId: courtB.id }], label: 'clerk-b' });
  users.lawyerA = await createUser({ roles: ['LAWYER'], label: 'lawyer-a' });
  await sql(`UPDATE "RoleAssignment" SET "panelId" = $2 WHERE id = $1`, [users.presidentA.roleAssignmentId, panelA]);
  const { judgeA, presidentA, clerkA, lawyerA } = users;

  // The cashier: «أداء الأتعاب» once the fees are ordered on the latest investigation and not paid.
  for (let i = 0; i < NOISE; i += 1) await file(courtA, { at: daysAgo(100 - i), status: 'IN_PREPARATION' });
  const earlierFees = await file(courtA, { at: daysAgo(60), status: 'IN_PREPARATION' });
  await investigation(earlierFees, { createdAt: daysAgo(40), feesOrderedCents: 300_000 });
  await investigation(earlierFees, { createdAt: daysAgo(20) });
  seeded.twoInvestigations = earlierFees;
  const paid = await file(courtA, { at: daysAgo(55), status: 'IN_PREPARATION' });
  await investigation(paid, { createdAt: daysAgo(30), feesOrderedCents: 300_000, feesPaidAt: daysAgo(2) });
  const fees = await file(courtA, { at: daysAgo(10), status: 'IN_PREPARATION' });
  await investigation(fees, { createdAt: daysAgo(9), feesOrderedCents: 450_000 });
  awaited.cashierA.push([fees, label('case.expert.pay-fees')]);
  const feesB = await file(courtB, { at: daysAgo(12), status: 'IN_PREPARATION' });
  await investigation(feesB, { createdAt: daysAgo(11), feesOrderedCents: 450_000 });
  awaited.cashierB.push([feesB, label('case.expert.pay-fees')]);

  // The judge rapporteur: under expertise, nothing awaits him while the deposit runs and the expert has not declined.
  for (let i = 0; i < NOISE; i += 1) {
    const id = await file(courtA, { at: daysAgo(200 - i), status: 'IN_EXPERTISE', rapporteur: judgeA });
    await investigation(id, { createdAt: daysAgo(199 - i) });
    await limit(id, await party(id, { facts: ['DEPOSIT_DUE'] }), 'INVESTIGATION_DEPOSIT', inDays(5));
  }
  const lapsed = await file(courtA, { at: daysAgo(150), status: 'IN_EXPERTISE', rapporteur: judgeA });
  await investigation(lapsed, { createdAt: daysAgo(149) });
  await limit(lapsed, await party(lapsed, { facts: ['DEPOSIT_DUE'] }), 'INVESTIGATION_DEPOSIT', daysAgo(2));
  awaited.judgeA.push([lapsed, label('case.investigation.authorize-other-party')]);
  const declined = await file(courtA, { at: daysAgo(140), status: 'IN_EXPERTISE', rapporteur: judgeA });
  await investigation(declined, { createdAt: daysAgo(139), depositedAt: daysAgo(130), declinedAt: daysAgo(120) });
  awaited.judgeA.push([declined, label('case.expert.replace')]);
  const declinedBefore = await file(courtA, { at: daysAgo(135), status: 'IN_EXPERTISE', rapporteur: judgeA });
  await investigation(declinedBefore, { createdAt: daysAgo(134), declinedAt: daysAgo(130) });
  await investigation(declinedBefore, { createdAt: daysAgo(125), depositedAt: daysAgo(120) });
  seeded.declinedBefore = declinedBefore;
  const toSet = await file(courtA, { at: daysAgo(5), status: 'RAPPORTEUR_ASSIGNED', rapporteur: judgeA });
  awaited.judgeA.push([toSet, label('case.hearing.set')]);

  // The panel president: a hearing in session today, not tomorrow nor yesterday; his turn in a circle; a pronouncement today.
  for (let i = 0; i < NOISE; i += 1) {
    const id = await file(courtA, { at: daysAgo(300 - i), status: 'READY', panel: panelA });
    await hearing(id, courtA, panelA, i % 2 === 0 ? inDays(2) : new Date(DAY_START.getTime() - 2 * 3_600_000));
  }
  const signMine = await file(courtA, { at: daysAgo(250), status: 'IN_DELIBERATION', panel: panelA, rapporteur: judgeA });
  await judgment(signMine, [judgeA, presidentA, clerkA], 1, 'OPEN');
  awaited.presidentA.push([signMine, label('case.judgment.sign')]);
  const signClerk = await file(courtA, { at: daysAgo(240), status: 'IN_DELIBERATION', panel: panelA, rapporteur: judgeA });
  await judgment(signClerk, [judgeA, clerkA, presidentA], 1, 'OPEN');
  seeded.presidentSignLater = signClerk;
  awaited.clerkA.push([signClerk, label('case.judgment.sign')]);
  const signJudge = await file(courtA, { at: daysAgo(238), status: 'IN_DELIBERATION', panel: panelA, rapporteur: judgeA });
  await judgment(signJudge, [presidentA, judgeA, clerkA], 1, 'OPEN');
  seeded.judgeSignOther = signJudge;
  awaited.judgeA.unshift([signJudge, label('case.judgment.sign')]);
  const pronounce = await file(courtA, { at: daysAgo(230), status: 'IN_DELIBERATION', panel: panelA, pronouncementDate: TODAY });
  await judgment(pronounce, [presidentA, clerkA], 2, 'COMPLETED');
  awaited.presidentA.push([pronounce, label('case.judgment.pronounce')]);
  const pronounceLater = await file(courtA, { at: daysAgo(225), status: 'IN_DELIBERATION', panel: panelA, pronouncementDate: addDays(TODAY, 1) });
  await judgment(pronounceLater, [presidentA, clerkA], 2, 'COMPLETED');
  const inSession = await file(courtA, { at: daysAgo(20), status: 'READY', panel: panelA });
  await hearing(inSession, courtA, panelA, new Date(Math.max(DAY_START.getTime(), NOW.getTime() - 60_000)));
  awaited.presidentA.push([inSession, label('case.hearing.adjourn')]);

  // The hearing clerk: the minutes of a hearing held, a judgment served in the hearing.
  const served = await file(courtA, { at: daysAgo(70), status: 'JUDGMENT_ISSUED' });
  await party(served, { facts: ['ATTENDED_PRONOUNCEMENT'] });
  awaited.clerkA.push([served, label('case.judgment.serve-in-hearing')]);
  const servedAlready = await file(courtA, { at: daysAgo(69), status: 'JUDGMENT_ISSUED' });
  await party(servedAlready, { facts: ['ATTENDED_PRONOUNCEMENT', 'JUDGMENT_SERVED'] });
  const held = await file(courtA, { at: daysAgo(60), status: 'READY', panel: panelA });
  await hearing(held, courtA, panelA, daysAgo(2), daysAgo(2));
  awaited.clerkA.push([held, label('case.minutes.record')]);
  const recorded = await file(courtA, { at: daysAgo(59), status: 'READY', panel: panelA, facts: ['MINUTES_RECORDED'] });
  await hearing(recorded, courtA, panelA, daysAgo(2), daysAgo(2));
  awaited.clerkA.push([inSession, label('case.minutes.record')]);
  // Court B: the minutes of a hearing held, and minutes recorded but not signed.
  const heldB = await file(courtB, { at: daysAgo(65), status: 'READY', panel: panelB });
  await hearing(heldB, courtB, panelB, daysAgo(3), daysAgo(3));
  awaited.clerkB.push([heldB, label('case.minutes.record')]);
  seeded.courtBMinutes = await file(courtB, { at: daysAgo(64), status: 'READY', panel: panelB, facts: ['MINUTES_RECORDED'] });
  await hearing(seeded.courtBMinutes, courtB, panelB, daysAgo(3), daysAgo(3));

  // The lawyer: the deposit of his client, due within its limit or authorized.
  for (let i = 0; i < NOISE; i += 1) {
    const id = await file(courtA, { at: daysAgo(400 - i), status: 'IN_EXPERTISE' });
    await investigation(id, { createdAt: daysAgo(399 - i) });
    await limit(id, await party(id, { facts: ['DEPOSIT_DUE'], lawyer: lawyerA }), 'INVESTIGATION_DEPOSIT', daysAgo(1), 'ELAPSED');
  }
  const otherParty = await file(courtA, { at: daysAgo(37), status: 'IN_EXPERTISE' });
  await investigation(otherParty, { createdAt: daysAgo(36) });
  await party(otherParty, { lawyer: lawyerA });
  await limit(otherParty, await party(otherParty, { side: 'DEFENDANT', facts: ['DEPOSIT_DUE'] }), 'INVESTIGATION_DEPOSIT', inDays(4));
  const made = await file(courtA, { at: daysAgo(36), status: 'IN_EXPERTISE' });
  await investigation(made, { createdAt: daysAgo(35), depositedAt: daysAgo(3) });
  await limit(made, await party(made, { facts: ['DEPOSIT_DUE'], lawyer: lawyerA }), 'INVESTIGATION_DEPOSIT', inDays(4));
  const authorized = await file(courtA, { at: daysAgo(35), status: 'IN_EXPERTISE' });
  await investigation(authorized, { createdAt: daysAgo(34) });
  await party(authorized, { facts: ['DEPOSIT_AUTHORIZED'], lawyer: lawyerA });
  awaited.lawyerA.push([authorized, label('case.investigation.deposit')]);
  const due = await file(courtA, { at: daysAgo(30), status: 'IN_EXPERTISE' });
  await investigation(due, { createdAt: daysAgo(29) });
  await limit(due, await party(due, { facts: ['DEPOSIT_DUE'], lawyer: lawyerA }), 'INVESTIGATION_DEPOSIT', inDays(5));
  awaited.lawyerA.push([due, label('case.investigation.deposit')]);

  // The judge's and the clerk's lists, the oldest first.
  const registered = async (id: string) => (await one<{ at: Date }>(`SELECT "registeredAt" AS at FROM "CaseFile" WHERE id = $1`, [id])).at.getTime();
  for (const key of Object.keys(awaited) as (keyof typeof awaited)[]) {
    const times = new Map<string, number>();
    for (const [id] of awaited[key]) times.set(id, await registered(id));
    const firstOf = new Map<string, string>();
    for (const [id, act] of awaited[key]) if (!firstOf.has(id)) firstOf.set(id, act);
    awaited[key] = [...firstOf.entries()].sort((a, b) => (times.get(a[0]) ?? 0) - (times.get(b[0]) ?? 0));
  }
}, 240_000);

// ---------------------------------------------------------------------------

describe('«ينتظر إجراء مني» counts only the files in which an act awaits', () => {
  const cases = [
    ['the cashier, behind files in preparation without fees ordered', 'cashierA'],
    ['the judge rapporteur, behind files under expertise where nothing lapsed', 'judgeA'],
    ['the panel president, behind hearings tomorrow and yesterday', 'presidentA'],
    ['the hearing clerk, who never signs minutes no file gives him', 'clerkA'],
    ['the lawyer, behind deposits lapsed, made, or due from another party', 'lawyerA'],
    ['the cashier of the other court', 'cashierB'],
    ['the hearing clerk of the other court', 'clerkB'],
  ] as const;

  for (const [title, key] of cases) {
    it(`for ${title}: the oldest awaiting file first, on the first page, with the number of such files`, async () => {
      const subject = await subjectOf(users[key]);
      const first = (await dashboardFor(subject, null, context(), { awaiting: 1, deadlines: 1 })).waiting;
      const expected = awaited[key];
      expect(first.total).toBe(expected.length);
      expect(filesOf(first.rows)).toEqual(expected.map(([id]) => id));
      for (const [id, act] of expected) expect(first.rows.filter((r) => r.caseFileId === id).map((r) => r.labelKey), id).toContain(act);
    });
  }

  it('never shows the cashier the fees of an earlier investigation, nor the judge the decline of an earlier expert', async () => {
    const cashier = filesOf((await dashboardFor(await subjectOf(users.cashierA), null, context())).waiting.rows);
    expect(cashier).not.toContain(seeded.twoInvestigations);
    const judge = filesOf((await dashboardFor(await subjectOf(users.judgeA), null, context())).waiting.rows);
    expect(judge).not.toContain(seeded.declinedBefore);
  });

  it('shows the signature of a judgment to its next signer only', async () => {
    const president = filesOf((await dashboardFor(await subjectOf(users.presidentA), null, context())).waiting.rows);
    expect(president).not.toContain(seeded.presidentSignLater);
    const judge = (await dashboardFor(await subjectOf(users.judgeA), null, context())).waiting.rows;
    expect(judge.filter((r) => r.caseFileId === seeded.judgeSignOther).map((r) => r.labelKey)).toEqual([label('case.judgment.sign')]);
  });
});

describe('what every page of «ينتظر إجراء مني» shows is what the core grants', () => {
  const everyFile = async () => (await sql<{ id: string }>(`SELECT id FROM "CaseFile"`)).map((r) => r.id);

  for (const key of ['cashierA', 'cashierB', 'judgeA', 'presidentA', 'clerkA', 'clerkB', 'lawyerA'] as const) {
    it(`for ${key}: file for file, every page with a count has its acts, and the count is the number of files`, async () => {
      const subject = await subjectOf(users[key]);
      const granted = new Map<string, string[]>();
      for (const id of await everyFile()) {
        const snapshot = await caseSnapshot(id, NOW);
        if (!snapshot) continue;
        const resource = { kind: 'case', snapshot } as const;
        if (!authorize(subject, 'case.view', resource, context()).allowed) continue;
        const acts = availableActions(subject, resource, context()).filter((rule) => rule.procedure?.awaited).map((rule) => rule.labelKey);
        if (acts.length > 0) granted.set(id, acts);
      }
      const pages = await allPages(subject);
      for (const page of pages) if (page.total > 0) expect(page.rows.length, `page ${String(page.page)} of ${key}`).toBeGreaterThan(0);
      const shown = pages.flatMap((p) => p.rows);
      expect(pages[0]?.total).toBe(granted.size);
      expect(new Set(filesOf(shown))).toEqual(new Set(granted.keys()));
      for (const [id, acts] of granted) expect(shown.filter((r) => r.caseFileId === id).map((r) => r.labelKey).sort(), id).toEqual([...acts].sort());
    }, 120_000);
  }
});

describe('a list never selects outside the files the user may open', () => {
  it('offers no translation of a scope that is not bound by «case.view»', () => {
    expect(Object.keys(scope)).not.toContain('scopeWhere');
  });

  it('counts no file of another court through a relation the query cannot read from a column of the file', async () => {
    const subject = await subjectOf(users.clerkA);
    const db = getDb();
    const minutes = await db.caseFile.count({ where: scope.scopesWhere(subject, NOW, actionScope(subject, 'case.minutes.sign')) });
    expect(minutes).toBe(0);
    const ids = (await db.caseFile.findMany({ where: scope.scopesWhere(subject, NOW, awaitedScope(subject)), select: { id: true } })).map((f) => f.id);
    expect(ids).not.toContain(seeded.courtBMinutes);
    expect(new Set(ids)).toEqual(new Set(awaited.clerkA.map(([id]) => id)));
  });

  it('selects the signature of a judgment for its next signer, and for no one else', async () => {
    const db = getDb();
    const president = await subjectOf(users.presidentA);
    const sign = await db.caseFile.findMany({ where: scope.scopesWhere(president, NOW, actionScope(president, 'case.judgment.sign')), select: { id: true } });
    expect(sign.map((f) => f.id)).toEqual([awaited.presidentA[0]?.[0]]);
    const others = await db.caseFile.count({ where: scope.outsideScopeWhere(president, NOW, actionScope(president, 'case.judgment.sign')) });
    const all = await db.caseFile.count({ where: scope.scopesWhere(president, NOW) });
    expect(others + sign.length).toBe(all);
  });
});

describe('the latest investigation of a file', () => {
  const marks = async (caseFileId: string) =>
    (await sql<{ latest: boolean }>(`SELECT latest FROM "Investigation" WHERE "caseFileId" = $1 ORDER BY "createdAt", id`, [caseFileId])).map((r) => r.latest);

  it('is the one created last, and only it is marked, whatever the order of insertion', async () => {
    expect(await marks(seeded.twoInvestigations)).toEqual([false, true]);
    await investigation(seeded.twoInvestigations, { createdAt: daysAgo(50) });
    expect(await marks(seeded.twoInvestigations)).toEqual([false, false, true]);
    const newest = await investigation(seeded.twoInvestigations, { createdAt: daysAgo(1), feesOrderedCents: 100 });
    expect(await marks(seeded.twoInvestigations)).toEqual([false, false, false, true]);
    const snapshot = await caseSnapshot(seeded.twoInvestigations, NOW);
    expect(snapshot?.facts).toContain('FEES_ORDERED');
    await sql(`UPDATE "Investigation" SET "createdAt" = $2 WHERE id = $1`, [newest, daysAgo(80)]);
    expect(await marks(seeded.twoInvestigations)).toEqual([false, false, false, true]);
    expect((await caseSnapshot(seeded.twoInvestigations, NOW))?.facts).not.toContain('FEES_ORDERED');
  });

  it('cannot be two in one file', async () => {
    await expect(sql(`UPDATE "Investigation" SET latest = true WHERE "caseFileId" = $1`, [seeded.twoInvestigations])).rejects.toThrow();
  });

  // Review of the IR-11 fix: the mark is kept on insertion and on a change of date or file, not on
  // deletion; deleting the marked row would leave the file with none, and its facts with it. The
  // runtime role deletes no investigation, as it deletes no document.
  it('is never deleted by the platform, so that no file loses its mark', async () => {
    const before = await marks(seeded.twoInvestigations);
    await expect(runtime().query(`DELETE FROM "Investigation" WHERE "caseFileId" = $1 AND latest`, [seeded.twoInvestigations])).rejects.toThrow(/permission denied/);
    await expect(runtime().query(`TRUNCATE "Investigation"`)).rejects.toThrow(/permission denied/);
    expect(await marks(seeded.twoInvestigations)).toEqual(before);
    expect(before.filter(Boolean)).toHaveLength(1);
  });
});
