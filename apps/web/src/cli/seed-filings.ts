// Phase 2 demo data, filed through the platform's own path (no shortcut into
// the tables): the plaintiff's lawyer files a case against a public
// establishment, pays the fee on the simulated gateway, signs and files; the
// file is registered and referred to the prosecution (art. 20). The registry
// office then finds it among «الملفات الواردة», the cashier among its payments.
// Idempotent: nothing is filed again once the case exists.
import { CARD_SECTIONS, type UserSubject } from '@mahkama/core';
import { getDb } from '@/server/db';
import type { EventActor } from '@/server/events/append';
import { loadDraft, type DraftWithParts } from '@/server/filings/drafts';
import { createDraft, pasteApplication, updateDraft, uploadDocument } from '@/server/filings/service';
import { submitDraft } from '@/server/filings/registration';
import { JOB_HANDLERS } from '@/server/jobs/handlers';
import { runDueJobs } from '@/server/jobs/queue';
import { openPayment, settlePayment } from '@/server/payments/service';
import { depositedPdf } from './seed-cases';
import { DEMO_REFERRED_FILING } from './seed-data/filings';
import { demoEmail } from './seed-data/accounts';

async function lawyerSubject(): Promise<{ subject: UserSubject; actor: EventActor }> {
  const user = await getDb().user.findUniqueOrThrow({ where: { email: demoEmail('lawyer.plaintiff') }, select: { id: true, isDemo: true } });
  const assignment = await getDb().roleAssignment.findFirstOrThrow({ where: { userId: user.id, role: 'LAWYER', revokedAt: null } });
  const roleCount = await getDb().roleAssignment.count({ where: { userId: user.id, revokedAt: null } });
  const subject: UserSubject = {
    kind: 'user',
    userId: user.id,
    role: assignment.role,
    roleAssignmentId: assignment.id,
    courtId: assignment.courtId,
    panelId: assignment.panelId,
    organizationId: assignment.organizationId,
    isDemoAccount: user.isDemo,
    roleCount,
    verificationStatus: assignment.verificationStatus,
  };
  return { subject, actor: { userId: user.id, roleAssignmentId: assignment.id, role: assignment.role, viaDemoSwitch: false } };
}

async function fresh(draftId: string): Promise<DraftWithParts> {
  const draft = await loadDraft(draftId);
  if (!draft) throw new Error('seed-filings: draft vanished');
  return draft;
}

function expectOk(outcome: { ok: boolean; code?: string }, step: string): void {
  if (!outcome.ok) throw new Error(`seed-filings: ${step} refused (${outcome.code ?? 'unknown'})`);
}

async function drainJobs(): Promise<void> {
  for (let round = 0; round < 5; round += 1) if ((await runDueJobs(JOB_HANDLERS)) === 0) return;
}

/** Files the referred demo case once; returns whether it filed it now. */
export async function seedReferredFiling(signingSecret: string): Promise<boolean> {
  const db = getDb();
  const marker = DEMO_REFERRED_FILING.card.parties[1].name;
  if (await db.caseParty.findFirst({ where: { displayName: marker }, select: { id: true } })) return false;
  const { subject, actor } = await lawyerSubject();
  const demo = DEMO_REFERRED_FILING;

  // A run without a browser left the draft unfiled: it is taken up again, never duplicated (review P2-A-12).
  const left = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "FilingDraft"
     WHERE "ownerUserId" = ${subject.userId}::uuid AND status = 'DRAFT' AND card::text LIKE ${`%${marker}%`}
     ORDER BY "createdAt" ASC LIMIT 1`;
  let draftId = left[0]?.id ?? null;
  if (draftId) {
    if ((await fresh(draftId)).fixedCopyStatus !== 'READY') {
      expectOk(await pasteApplication(await fresh(draftId), demo.applicationText, actor), 'application');
      await drainJobs();
    }
    if ((await fresh(draftId)).fixedCopyStatus !== 'READY') {
      console.log(JSON.stringify({ level: 'warn', msg: 'seed-filings: fixed copy still not ready, the referred demo case stays a draft' }));
      return false;
    }
    return fileDraft(draftId, subject, actor, signingSecret);
  }
  const created = await createDraft(subject, 'ELECTRONIC', actor);
  if (!created.ok) throw new Error(`seed-filings: draft refused (${created.code})`);
  draftId = created.value;
  expectOk(await updateDraft(await fresh(draftId), subject, { caseType: demo.caseType, defendantLocality: demo.defendantLocality }, actor), 'case type');
  const suggested = (await fresh(draftId)).suggestedCourtId;
  const court = suggested ?? (await db.court.findFirstOrThrow({ where: { degree: 'FIRST_INSTANCE', specialty: 'COMMERCIAL' }, select: { id: true } })).id;
  expectOk(await updateDraft(await fresh(draftId), subject, { courtId: court }, actor), 'court');
  expectOk(await pasteApplication(await fresh(draftId), demo.applicationText, actor), 'application');
  await drainJobs();
  expectOk(await updateDraft(await fresh(draftId), subject, { card: demo.card, attest: [...CARD_SECTIONS] }, actor), 'case card');
  for (const [i, exhibit] of demo.exhibits.entries()) {
    const uploaded = await uploadDocument(
      await fresh(draftId),
      { draftId, kind: 'EXHIBIT', name: `exhibit-${String(i + 1)}.pdf`, title: exhibit.title, nature: exhibit.nature },
      depositedPdf(`exhibit ${String(i + 1)}`),
      actor,
    );
    expectOk(uploaded, `exhibit ${String(i + 1)}`);
  }
  if ((await fresh(draftId)).fixedCopyStatus !== 'READY') {
    // Without a browser the fixed copy cannot be printed: the draft stays a draft, like the documents of seed-cases.
    console.log(JSON.stringify({ level: 'warn', msg: 'seed-filings: fixed copy not ready, the referred demo case is left as a draft' }));
    return false;
  }

  return fileDraft(draftId, subject, actor, signingSecret);
}

/** Pays the fee of the demo draft on the simulated gateway (once), signs and files it. */
async function fileDraft(draftId: string, subject: UserSubject, actor: EventActor, signingSecret: string): Promise<boolean> {
  const draft = await fresh(draftId);
  if (!draft.intents.some((i) => i.status === 'SUCCEEDED')) {
    const opened = await openPayment(draft, subject, actor);
    if (!opened.ok) throw new Error(`seed-filings: payment refused (${opened.code})`);
    expectOk(await settlePayment(opened.intentId, subject, 'SUCCEEDED', actor), 'payment');
    await drainJobs();
  }
  const filed = await submitDraft(draftId, subject, signingSecret, actor);
  if (!filed.ok) throw new Error(`seed-filings: filing refused (${filed.code})`);
  await drainJobs();
  return true;
}
