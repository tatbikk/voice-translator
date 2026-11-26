// The lists never cut silently, and never drop the files waiting longest
// (independent review IR-11), written before the code. Each list seeds more
// files than its page:
//   - «الملفات الواردة» of the registry office: «مقيد» and not stamped, of its
//     court, the oldest first, in pages, with the total;
//   - «الإحالات» of the prosecution: its referrals, while it may still file its
//     conclusions, the oldest first, in pages, by ground;
//   - «ينتظر إجراء مني»: the files in the state where an act awaits the user,
//     by his relation and his office, the oldest first, in pages;
//   - «آجال تقترب»: a running time limit on an old file, behind sixty newer
//     files of the same lawyer, still shows;
//   - «لائحة الملفات» and «مشاريع الإيداع»: in pages, with the total;
//   - with two courts and two owners, no list shows a file, a referral or a
//     draft of the other court or the other owner;
//   - what the query selects is what the core grants (case.view), row for row.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { authorize, availableActions, type UserSubject } from '@mahkama/core';
import { caseSnapshot } from '@/server/cases/snapshot';
import { dashboardFor } from '@/server/dashboard/service';
import { casesOf, draftsOf } from '@/server/filings/lists';
import { cutOf, PAGE_SIZE, type Page } from '@/server/lists/paging';
import { prosecutionReferrals, type ReferredFile } from '@/server/offices/prosecution';
import { incomingFiles } from '@/server/offices/registry';
import { one, sql } from '../helpers/db';
import { createCaseFile, createCourt, createUser, type CourtFixture, type TestUser } from '../helpers/factories';
import { useFreshDatabase } from '../helpers/reset';

useFreshDatabase();

const NOW = new Date();
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY);
const context = () => ({ mode: 'demo' as const, demoToolsEnabled: false, now: NOW });

interface Cast {
  readonly clerkA: TestUser;
  readonly clerkB: TestUser;
  readonly presidentA: TestUser;
  readonly prosecutorA: TestUser;
  readonly prosecutorB: TestUser;
  readonly lawyerA: TestUser;
  readonly lawyerB: TestUser;
}

let courtA: CourtFixture;
let courtB: CourtFixture;
let cast: Cast;

/** What the seed made, by list, the oldest first. */
const seeded = {
  incomingA: [] as string[],
  incomingB: [] as string[],
  stampedRegisteredA: [] as string[],
  principalA: [] as string[],
  communicationA: [] as string[],
  referralsB: [] as string[],
  judgedReferredA: '' as string,
  lawyerA: [] as string[],
  lawyerB: [] as string[],
  limitFilesA: [] as string[],
  limitB: '' as string,
  draftsA: [] as string[],
  draftsB: [] as string[],
};

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

/** A file registered on the given day, as the platform registers it. */
async function registeredFile(court: CourtFixture, options: { at: Date; status?: string; stamped?: boolean; referred?: boolean }): Promise<string> {
  const file = await createCaseFile({ courtId: court.id, status: options.status ?? 'REGISTERED' });
  await sql(
    `UPDATE "CaseFile" SET "registeredAt" = $2, "createdAt" = $2, "registrationStampedAt" = $3, "referredToProsecutionAt" = $4 WHERE id = $1`,
    [file.id, options.at, options.stamped ? new Date(options.at.getTime() + DAY) : null, options.referred ? options.at : null],
  );
  return file.id;
}

async function refer(caseFileId: string, ground: 'PRINCIPAL_PARTY' | 'COMMUNICATION', at: Date): Promise<void> {
  await sql(
    `INSERT INTO "CaseReferral" (id, "caseFileId", target, ground, article, item, "reasonCode", "ruleSetId", "createdAt")
     VALUES ($1, $2, 'PROSECUTION', $3::"ReferralGround", $4, NULL, $5, $6, $7)`,
    [randomUUID(), caseFileId, ground, ground === 'PRINCIPAL_PARTY' ? 18 : 20, ground === 'PRINCIPAL_PARTY' ? 'CASE_TYPE' : 'PUBLIC_PARTY', randomUUID(), at],
  );
}

/** A plaintiff the lawyer represents; returns the party. */
async function represent(caseFileId: string, lawyer: TestUser): Promise<string> {
  const partyId = randomUUID();
  await sql(`INSERT INTO "CaseParty" (id, "caseFileId", side, "personKind", "displayName", position) VALUES ($1, $2, 'PLAINTIFF', 'LEGAL', 'شركة الاختبار', 1)`, [partyId, caseFileId]);
  await sql(`INSERT INTO "Representation" (id, "partyId", "lawyerUserId", "startedAt") VALUES ($1, $2, $3, now())`, [randomUUID(), partyId, lawyer.id]);
  return partyId;
}

async function timeLimit(caseFileId: string, partyId: string, endsAt: Date, status = 'RUNNING'): Promise<void> {
  await sql(
    `INSERT INTO "TimeLimit" (id, "caseFileId", "ruleCode", "ruleSetId", "partyId", "startsAt", "endsAt", "lastDay", status, computation)
     VALUES ($1, $2, 'REPLY', $3, $4, $5, $6, $7, $8::"TimeLimitStatus", '{}'::jsonb)`,
    [randomUUID(), caseFileId, randomUUID(), partyId, daysAgo(1), endsAt, endsAt.toISOString().slice(0, 10), status],
  );
}

async function draft(owner: TestUser, updatedAt: Date): Promise<string> {
  const id = randomUUID();
  await sql(
    `INSERT INTO "FilingDraft" (id, "ownerUserId", "ownerRoleAssignmentId", channel, status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'ELECTRONIC', 'DRAFT', $4, $4)`,
    [id, owner.id, owner.roleAssignmentId, updatedAt],
  );
  return id;
}

/** Every page of a list, read one after the other. */
async function allPages<T>(read: (page: number) => Promise<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page < 100; page += 1) {
    const current = await read(page);
    rows.push(...current.rows);
    if (current.to >= current.total) return rows;
  }
  throw new Error('more than 100 pages');
}

const ids = (rows: readonly { caseFileId: string }[]) => rows.map((r) => r.caseFileId);

beforeAll(async () => {
  courtA = await createCourt();
  courtB = await createCourt();
  cast = {
    clerkA: await createUser({ roles: [{ role: 'CLERK_REGISTRATION', courtId: courtA.id }], label: 'clerk-a' }),
    clerkB: await createUser({ roles: [{ role: 'CLERK_REGISTRATION', courtId: courtB.id }], label: 'clerk-b' }),
    presidentA: await createUser({ roles: [{ role: 'COURT_PRESIDENT', courtId: courtA.id }], label: 'president-a' }),
    prosecutorA: await createUser({ roles: [{ role: 'PUBLIC_PROSECUTOR', courtId: courtA.id }], label: 'prosecutor-a' }),
    prosecutorB: await createUser({ roles: [{ role: 'PUBLIC_PROSECUTOR', courtId: courtB.id }], label: 'prosecutor-b' }),
    lawyerA: await createUser({ roles: ['LAWYER'], label: 'lawyer-a' }),
    lawyerB: await createUser({ roles: ['LAWYER'], label: 'lawyer-b' }),
  };

  // Each list is seeded newest first, so that the order of insertion is never the order shown.
  // «الملفات الواردة»: three more than a page, registered from 30 days ago on.
  const incoming = PAGE_SIZE.incoming + 3;
  for (let i = incoming - 1; i >= 0; i -= 1) seeded.incomingA[i] = await registeredFile(courtA, { at: daysAgo(30 - i) });
  for (let i = 1; i >= 0; i -= 1) seeded.incomingB[i] = await registeredFile(courtB, { at: daysAgo(10 - i) });
  // Stamped, older still: not «واردة», but they await the president's assignment of a rapporteur.
  for (let i = 2; i >= 0; i -= 1) seeded.stampedRegisteredA[i] = await registeredFile(courtA, { at: daysAgo(40 - i), stamped: true });

  // «الإحالات»: three more than a page on the principal ground, two communicated, one file judged.
  const principal = PAGE_SIZE.referrals + 3;
  for (let i = principal - 1; i >= 0; i -= 1) {
    const id = await registeredFile(courtA, { at: daysAgo(60 - i), status: 'IN_PREPARATION', stamped: true, referred: true });
    await refer(id, 'PRINCIPAL_PARTY', daysAgo(60 - i));
    seeded.principalA[i] = id;
  }
  for (let i = 1; i >= 0; i -= 1) {
    const id = await registeredFile(courtA, { at: daysAgo(20 - i), status: 'IN_PREPARATION', stamped: true, referred: true });
    await refer(id, 'COMMUNICATION', daysAgo(20 - i));
    seeded.communicationA[i] = id;
  }
  seeded.judgedReferredA = await registeredFile(courtA, { at: daysAgo(90), status: 'JUDGMENT_ISSUED', stamped: true, referred: true });
  await refer(seeded.judgedReferredA, 'PRINCIPAL_PARTY', daysAgo(90));
  for (let i = 1; i >= 0; i -= 1) {
    const id = await registeredFile(courtB, { at: daysAgo(15 - i), status: 'IN_PREPARATION', stamped: true, referred: true });
    await refer(id, 'PRINCIPAL_PARTY', daysAgo(15 - i));
    seeded.referralsB[i] = id;
  }

  // «آجال تقترب»: the lawyer's oldest file has the nearest limit, sixty-one files newer than it.
  const files = 62;
  const parties: string[] = [];
  for (let i = files - 1; i >= 0; i -= 1) {
    const id = await registeredFile(courtA, { at: daysAgo(i === 0 ? 200 : 100 - i), status: 'IN_PREPARATION', stamped: true });
    seeded.lawyerA[i] = id;
    parties[i] = await represent(id, cast.lawyerA);
  }
  const limits = PAGE_SIZE.deadlines + 2;
  for (let i = 0; i < limits; i += 1) {
    const index = i === 0 ? 0 : files - i;
    await timeLimit(seeded.lawyerA[index] ?? '', parties[index] ?? '', inDays(2 + i));
    seeded.limitFilesA.push(seeded.lawyerA[index] ?? '');
  }
  // Neither an elapsed limit, nor one beyond fifteen days, approaches.
  await timeLimit(seeded.lawyerA[30] ?? '', parties[30] ?? '', inDays(3), 'ELAPSED');
  await timeLimit(seeded.lawyerA[31] ?? '', parties[31] ?? '', inDays(20));
  seeded.limitB = await registeredFile(courtB, { at: daysAgo(50), status: 'IN_PREPARATION', stamped: true });
  seeded.lawyerB.push(seeded.limitB);
  await timeLimit(seeded.limitB, await represent(seeded.limitB, cast.lawyerB), inDays(1));

  // «مشاريع الإيداع»: two more than a page for one lawyer, two for the other.
  const drafts = PAGE_SIZE.drafts + 2;
  for (let i = 0; i < drafts; i += 1) seeded.draftsA.push(await draft(cast.lawyerA, daysAgo(i)));
  for (let i = 0; i < 2; i += 1) seeded.draftsB.push(await draft(cast.lawyerB, daysAgo(i)));
}, 180_000);

// ---------------------------------------------------------------------------

describe('«الملفات الواردة» of the registry office', () => {
  it('shows the file registered longest ago first, a page at a time, and says how many there are', async () => {
    const subject = await subjectOf(cast.clerkA);
    const first = await incomingFiles(subject, context(), 1);
    expect(first.total).toBe(PAGE_SIZE.incoming + 3);
    expect(ids(first.rows)).toEqual(seeded.incomingA.slice(0, PAGE_SIZE.incoming));
    expect(cutOf(first)).toEqual({ from: 1, to: PAGE_SIZE.incoming, total: PAGE_SIZE.incoming + 3, previous: null, next: 2 });
    const times = first.rows.map((r) => r.registeredAt?.getTime() ?? 0);
    expect(times).toEqual([...times].sort((a, b) => a - b));

    const second = await incomingFiles(subject, context(), 2);
    expect(ids(second.rows)).toEqual(seeded.incomingA.slice(PAGE_SIZE.incoming));
    expect(cutOf(second)).toEqual({ from: PAGE_SIZE.incoming + 1, to: PAGE_SIZE.incoming + 3, total: PAGE_SIZE.incoming + 3, previous: 1, next: null });
  });

  it('shows the last page for a page beyond it', async () => {
    const beyond = await incomingFiles(await subjectOf(cast.clerkA), context(), 99);
    expect(beyond.page).toBe(2);
    expect(ids(beyond.rows)).toEqual(seeded.incomingA.slice(PAGE_SIZE.incoming));
  });

  it('never shows a stamped file, nor one of another court', async () => {
    const subject = await subjectOf(cast.clerkA);
    const all = ids(await allPages((page) => incomingFiles(subject, context(), page)));
    expect(new Set(all)).toEqual(new Set(seeded.incomingA));
    const other = await incomingFiles(await subjectOf(cast.clerkB), context(), 1);
    expect(other.total).toBe(2);
    expect(ids(other.rows)).toEqual(seeded.incomingB);
    expect(cutOf(other)).toBeNull();
  });
});

describe('«الإحالات» of the prosecution', () => {
  it('shows the referral received longest ago first on each ground, a page at a time, with the total', async () => {
    const subject = await subjectOf(cast.prosecutorA);
    const first = await prosecutionReferrals(subject, context(), { principal: 1, communication: 1 });
    expect(first?.principalParty.total).toBe(PAGE_SIZE.referrals + 3);
    expect(ids(first?.principalParty.rows ?? [])).toEqual(seeded.principalA.slice(0, PAGE_SIZE.referrals));
    expect(cutOf(first?.principalParty ?? emptyPage())).toMatchObject({ from: 1, to: PAGE_SIZE.referrals, total: PAGE_SIZE.referrals + 3, next: 2 });
    expect(ids(first?.communication.rows ?? [])).toEqual(seeded.communicationA);
    expect(cutOf(first?.communication ?? emptyPage())).toBeNull();

    const second = await prosecutionReferrals(subject, context(), { principal: 2, communication: 1 });
    expect(ids(second?.principalParty.rows ?? [])).toEqual(seeded.principalA.slice(PAGE_SIZE.referrals));
    expect(ids(second?.communication.rows ?? [])).toEqual(seeded.communicationA);
  });

  it('leaves out a file in which its conclusions can no longer be filed, which stays in «لائحة الملفات»', async () => {
    const subject = await subjectOf(cast.prosecutorA);
    const principal = await allPages(async (page) => (await prosecutionReferrals(subject, context(), { principal: page, communication: 1 }))?.principalParty ?? emptyPage<ReferredFile>());
    expect(ids(principal)).not.toContain(seeded.judgedReferredA);
    const cases = await allPages((page) => casesOf(subject, context(), page));
    expect(cases.map((r) => r.id)).toContain(seeded.judgedReferredA);
  });

  it('never shows a referral of another court', async () => {
    const other = await prosecutionReferrals(await subjectOf(cast.prosecutorB), context(), { principal: 1, communication: 1 });
    expect(ids(other?.principalParty.rows ?? [])).toEqual(seeded.referralsB);
    expect(other?.communication.total).toBe(0);
  });
});

describe('«ينتظر إجراء مني»', () => {
  it('shows the registry office the file waiting longest for its stamp first, a page at a time, with the number of files', async () => {
    const subject = await subjectOf(cast.clerkA);
    const first = (await dashboardFor(subject, null, context(), { awaiting: 1, deadlines: 1 })).waiting;
    expect(first.total).toBe(PAGE_SIZE.incoming + 3);
    expect(first.rows.map((w) => [w.caseFileId, w.labelKey])).toEqual(
      seeded.incomingA.slice(0, PAGE_SIZE.awaiting).map((id) => [id, 'actions.case.registration.stamp.label']),
    );
    expect(cutOf(first)).toMatchObject({ from: 1, to: PAGE_SIZE.awaiting, total: PAGE_SIZE.incoming + 3, next: 2 });
    const second = (await dashboardFor(subject, null, context(), { awaiting: 2, deadlines: 1 })).waiting;
    expect(ids(second.rows)).toEqual(seeded.incomingA.slice(PAGE_SIZE.awaiting));
  });

  it('shows the court president, of the same court, the files of his own office: registered without a rapporteur, stamped or not', async () => {
    const subject = await subjectOf(cast.presidentA);
    const waiting = await allPages(async (page) => (await dashboardFor(subject, null, context(), { awaiting: page, deadlines: 1 })).waiting);
    const files = [...new Set(ids(waiting))];
    expect(files).toEqual([...seeded.stampedRegisteredA, ...seeded.incomingA]);
    const first = (await dashboardFor(subject, null, context(), { awaiting: 1, deadlines: 1 })).waiting;
    expect(first.total).toBe(seeded.stampedRegisteredA.length + seeded.incomingA.length);
    expect(first.rows[0]?.caseFileId).toBe(seeded.stampedRegisteredA[0]);
  });

  it('never shows a file of another court', async () => {
    const waiting = (await dashboardFor(await subjectOf(cast.clerkB), null, context(), { awaiting: 1, deadlines: 1 })).waiting;
    expect(ids(waiting.rows)).toEqual(seeded.incomingB);
  });
});

describe('«آجال تقترب»', () => {
  it('shows a running limit on the lawyer’s oldest file, behind sixty newer files, nearest first, a page at a time', async () => {
    const subject = await subjectOf(cast.lawyerA);
    const first = (await dashboardFor(subject, null, context(), { awaiting: 1, deadlines: 1 })).deadlines;
    expect(first.total).toBe(PAGE_SIZE.deadlines + 2);
    expect(first.rows[0]?.caseFileId).toBe(seeded.lawyerA[0]);
    expect(ids(first.rows)).toEqual(seeded.limitFilesA.slice(0, PAGE_SIZE.deadlines));
    const ends = first.rows.map((d) => d.endsAt.getTime());
    expect(ends).toEqual([...ends].sort((a, b) => a - b));
    expect(cutOf(first)).toMatchObject({ from: 1, to: PAGE_SIZE.deadlines, total: PAGE_SIZE.deadlines + 2, next: 2 });
    const second = (await dashboardFor(subject, null, context(), { awaiting: 1, deadlines: 2 })).deadlines;
    expect(ids(second.rows)).toEqual(seeded.limitFilesA.slice(PAGE_SIZE.deadlines));
  });

  it('never shows a limit of a file of another lawyer', async () => {
    const mine = await allPages(async (page) => (await dashboardFor(await subjectOf(cast.lawyerA), null, context(), { awaiting: 1, deadlines: page })).deadlines);
    expect(ids(mine)).not.toContain(seeded.limitB);
    const other = (await dashboardFor(await subjectOf(cast.lawyerB), null, context(), { awaiting: 1, deadlines: 1 })).deadlines;
    expect(ids(other.rows)).toEqual([seeded.limitB]);
  });
});

describe('«لائحة الملفات» and «مشاريع الإيداع»', () => {
  it('give the lawyer every file he acts in, a page at a time, each once, with the total', async () => {
    const subject = await subjectOf(cast.lawyerA);
    const first = await casesOf(subject, context(), 1);
    expect(first.total).toBe(seeded.lawyerA.length);
    expect(first.rows).toHaveLength(PAGE_SIZE.cases);
    expect(cutOf(first)).toMatchObject({ from: 1, to: PAGE_SIZE.cases, total: seeded.lawyerA.length, next: 2 });
    const all = (await allPages((page) => casesOf(subject, context(), page))).map((r) => r.id);
    expect(all).toHaveLength(seeded.lawyerA.length);
    expect(new Set(all)).toEqual(new Set(seeded.lawyerA));
    const other = (await allPages(async (page) => casesOf(await subjectOf(cast.lawyerB), context(), page))).map((r) => r.id);
    expect(other).toEqual(seeded.lawyerB);
  });

  it('give the registry office of the other court only its own files', async () => {
    const rows = await allPages(async (page) => casesOf(await subjectOf(cast.clerkB), context(), page));
    expect(new Set(rows.map((r) => r.courtName))).toEqual(new Set([courtB.name]));
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set([...seeded.incomingB, ...seeded.referralsB, seeded.limitB]));
  });

  it('give the lawyer his own drafts, the latest changed first, a page at a time, and never another’s', async () => {
    const first = await draftsOf(await subjectOf(cast.lawyerA), context(), 1);
    expect(first.total).toBe(PAGE_SIZE.drafts + 2);
    expect(first.rows.map((d) => d.id)).toEqual(seeded.draftsA.slice(0, PAGE_SIZE.drafts));
    expect(cutOf(first)).toMatchObject({ from: 1, to: PAGE_SIZE.drafts, total: PAGE_SIZE.drafts + 2, next: 2 });
    const second = await draftsOf(await subjectOf(cast.lawyerA), context(), 2);
    expect(second.rows.map((d) => d.id)).toEqual(seeded.draftsA.slice(PAGE_SIZE.drafts));
    const other = await draftsOf(await subjectOf(cast.lawyerB), context(), 1);
    expect(other.rows.map((d) => d.id)).toEqual(seeded.draftsB);
  });
});

describe('what the query selects is what the core grants', () => {
  const everyFile = async () => (await sql<{ id: string }>(`SELECT id FROM "CaseFile"`)).map((r) => r.id);

  for (const name of ['clerkA', 'clerkB', 'presidentA', 'prosecutorA', 'lawyerA'] as const) {
    it(`«لائحة الملفات» of ${name}: every file the core lets him open, and no other`, async () => {
      const subject = await subjectOf(cast[name]);
      const granted: string[] = [];
      for (const id of await everyFile()) {
        const snapshot = await caseSnapshot(id, NOW);
        if (snapshot && authorize(subject, 'case.view', { kind: 'case', snapshot }, context()).allowed) granted.push(id);
      }
      const listed = (await allPages((page) => casesOf(subject, context(), page))).map((r) => r.id);
      expect(new Set(listed)).toEqual(new Set(granted));
      expect(listed).toHaveLength(granted.length);
    }, 60_000);
  }

  for (const name of ['clerkA', 'presidentA'] as const) {
    it(`«ينتظر إجراء مني» of ${name}: every file in which the core says an act awaits him`, async () => {
      const subject = await subjectOf(cast[name]);
      const awaited: string[] = [];
      for (const id of await everyFile()) {
        const snapshot = await caseSnapshot(id, NOW);
        if (!snapshot) continue;
        const resource = { kind: 'case', snapshot } as const;
        if (!authorize(subject, 'case.view', resource, context()).allowed) continue;
        if (availableActions(subject, resource, context()).some((rule) => rule.procedure?.awaited)) awaited.push(id);
      }
      const shown = await allPages(async (page) => (await dashboardFor(subject, null, context(), { awaiting: page, deadlines: 1 })).waiting);
      expect(new Set(ids(shown))).toEqual(new Set(awaited));
    }, 60_000);
  }
});

function emptyPage<T>(): Page<T> {
  return { rows: [], page: 1, pageSize: 1, total: 0, from: 0, to: 0 };
}
