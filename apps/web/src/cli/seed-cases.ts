// Fills the demo case files (Phase 1): parties, counsel, claims, the court fee,
// the documents the platform generates (with the demo line on every page), the
// signature circles, the services and the running time limits, computed by the
// engine from the dated rule tables. Each file is filled once: a file that
// already has parties is left as it is. Every effect is written in the event
// log, and the history of a file is recorded as transitions of the procedure.
import { randomUUID } from 'node:crypto';
import {
  PROCEDURE_ACTIONS,
  assessCourtFee,
  computeTimeLimit,
  formatMoroccoDate,
  formatMoroccoTime,
  lawArticles,
  moroccoDay,
  type RoleCode,
} from '@mahkama/core';
import { clock } from '@/server/clock';
import { getDb } from '@/server/db';
import { asJson } from '@/server/json';
import { appendStandaloneEvent } from '@/server/events/append';
import { storeDocument } from '@/server/documents/service';
import { DocumentGenerationError, generatePdf, type GenerateInput, type TemplateName } from '@/server/documents/generate';
import { openSignatureCircle, setSigningSecret, signDocument } from '@/server/signature/service';
import { feeSchedule, holidayCalendar, timeLimitRules } from '@/server/rules/store';
import { translator } from '@/i18n/translate';
import { DEMO_CASE_CONTENT, DEMO_TEXTS, type DemoCaseContent } from './seed-data/cases';
import { demoEmail, type DemoCourtKey, type DemoPanelKey } from './seed-data/accounts';

const DAY = 86_400_000;
const t = translator('ar');

export interface SeedCaseContext {
  readonly courtIds: Record<DemoCourtKey, string>;
  readonly panelIds: Record<DemoPanelKey, string>;
  readonly signingSecret: string;
}

interface Party {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

async function userId(key: string): Promise<string> {
  const user = await getDb().user.findUnique({ where: { email: demoEmail(key) }, select: { id: true } });
  if (!user) throw new Error(`demo user missing: ${key}`);
  return user.id;
}

async function signer(key: string, role: RoleCode, panelId: string | null = null): Promise<{ userId: string; roleAssignmentId: string; name: string; role: RoleCode }> {
  const user = await getDb().user.findUnique({ where: { email: demoEmail(key) }, select: { id: true, fullName: true } });
  if (!user) throw new Error(`demo user missing: ${key}`);
  const assignment = await getDb().roleAssignment.findFirst({
    where: { userId: user.id, role, revokedAt: null, ...(panelId ? { panelId } : {}) },
    select: { id: true },
  });
  if (!assignment) throw new Error(`demo role missing: ${key} ${role}`);
  return { userId: user.id, roleAssignmentId: assignment.id, name: user.fullName, role };
}

function articlesOf(action: string): number[] {
  const rule = PROCEDURE_ACTIONS.find((a) => a.code === action);
  if (!rule) throw new Error(`unknown procedure action: ${action}`);
  return [...rule.articles];
}

function basisText(action: string): string {
  return DEMO_TEXTS.basis.replace('{articles}', articlesOf(action).join(DEMO_TEXTS.articleJoiner));
}

/** A small, valid PDF standing for a document deposited by a party (fictitious content). */
function depositedPdf(label: string): Uint8Array {
  const text = `DEMO - ${label}`.replace(/[()\\]/g, '');
  const stream = `BT /F1 14 Tf 72 760 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${String(i + 1)} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

interface FileRow {
  readonly id: string;
  readonly number: number;
  readonly code: number;
  readonly year: number;
  readonly nationalRef: string;
  readonly courtName: string;
  readonly panelName: string;
}

async function generated(
  file: FileRow,
  template: TemplateName,
  title: string,
  data: GenerateInput['data'],
  signers: readonly { name: string; role: RoleCode }[],
  visibility: 'CASE' | 'PANEL',
  docType: string,
): Promise<string | null> {
  const now = clock.now();
  const input: GenerateInput = {
    template,
    header: {
      logoSlot: t('documents.logoSlot'),
      headerLines: [file.courtName, t('documents.registry')],
      title,
      caseNumberLabel: t('documents.caseNumber'),
      caseNumber: `${String(file.number)}/${String(file.code)}/${String(file.year)}`,
      nationalRefLabel: t('documents.nationalRef'),
      nationalRef: file.nationalRef,
      dateLabel: t('documents.date'),
      date: formatMoroccoDate(now),
    },
    data,
    signatures: signers.map((s) => ({ role: t(`roles.${s.role}`), name: s.name, stamp: null, when: null, pendingText: t('documents.notSigned') })),
    environmentLine: t('documents.environmentLine'),
    pageLabel: t('documents.pageLabel'),
  };
  let bytes: Uint8Array;
  try {
    bytes = await generatePdf(input);
  } catch (error) {
    // Without a browser the file is still seeded, without its generated documents.
    if (error instanceof DocumentGenerationError) {
      await appendStandaloneEvent({ action: 'document.generation.failed', details: { template, errorClass: error.stage }, caseFileId: file.id });
      return null;
    }
    throw error;
  }
  const doc = await storeDocument({
    caseFileId: file.id,
    bytes,
    mediaType: 'application/pdf',
    docType,
    title,
    visibility,
    channel: 'ELECTRONIC',
    declaredNature: null,
    generated: true,
    simulated: true,
    depositedByUserId: null,
    depositedByPartyId: null,
  });
  return doc.id;
}

/** Opens the circle and has the first `signed` signers sign, in order. */
async function circle(
  documentId: string,
  purpose: string,
  signers: readonly { userId: string; roleAssignmentId: string }[],
  signed: number,
  secret: string,
): Promise<string> {
  const { id } = await openSignatureCircle({ documentId, purpose, signers });
  for (const s of signers.slice(0, signed)) {
    const result = await signDocument({ ...s, circleId: id, secret });
    if (!result.ok) throw new Error(`demo signature refused: ${result.reason}`);
  }
  return id;
}

async function transitions(caseFileId: string, steps: readonly [action: string, from: string, to: string][]): Promise<void> {
  for (const [action, fromStatus, toStatus] of steps) {
    await appendStandaloneEvent({
      action: 'case.transition.recorded',
      details: { action, fromStatus, toStatus },
      caseFileId,
      legalBasis: lawArticles(...articlesOf(action)),
    });
  }
}

async function timeLimit(caseFileId: string, code: string, partyId: string, trigger: Date, electronic: boolean): Promise<void> {
  const now = clock.now();
  const rules = await timeLimitRules(now);
  const rule = rules.rules.find((r) => r.code === code);
  if (!rule) throw new Error(`no time-limit rule ${code}`);
  const calendar = await holidayCalendar(now);
  const result = computeTimeLimit({ rule, settings: rules.settings, trigger, electronic, calendar });
  const ruleSet = await getDb().ruleSet.findUnique({ where: { kind_version: { kind: 'TIME_LIMITS', version: rules.version } }, select: { id: true } });
  if (!ruleSet) throw new Error('time-limit rule table not loaded');
  await getDb().timeLimit.create({
    data: {
      caseFileId,
      ruleCode: code,
      ruleSetId: ruleSet.id,
      partyId,
      startsAt: result.startsAt,
      endsAt: result.endsAt,
      lastDay: result.lastDay,
      electronic,
      status: result.endsAt.getTime() > now.getTime() ? 'RUNNING' : 'ELAPSED',
      // What the computation relied on, kept with it (review P1-A-09): the tables' versions, the
      // calendar's horizon, and whatever unsettled it rests on, from which the case page reads its flag.
      computation: asJson({
        steps: result.steps,
        articles: result.articles,
        ruleVersion: rules.version,
        calendarVersion: calendar.version,
        coversUntil: calendar.coversUntil,
        uncertainties: result.uncertainties,
      }),
    },
  });
}

async function courtFee(caseFileId: string, content: DemoCaseContent, payerPartyId: string, payerUserId: string, at: Date): Promise<string> {
  const schedule = await feeSchedule(at);
  const filing = content.caseType === 'APPEAL_COMMERCIAL' ? 'APPEAL' : 'APPLICATION';
  const claims = content.claims
    .filter((c) => c.category === 'PRINCIPAL')
    .map((c) => ({ nature: c.nature, amountCents: c.dirhams === null ? null : c.dirhams * 100 }));
  const assessment = assessCourtFee({ claims, filing, schedule });
  const ruleSet = await getDb().ruleSet.findUnique({ where: { kind_version: { kind: 'FEES', version: schedule.version } }, select: { id: true } });
  if (!ruleSet) throw new Error('fee rule table not loaded');
  const operationRef = `DEMO-PAY-${String(content.number)}`;
  await getDb().feeAssessment.create({
    data: { caseFileId, filing, ruleSetId: ruleSet.id, totalCents: BigInt(assessment.totalCents), breakdown: asJson(assessment), assessedAt: at },
  });
  await getDb().payment.create({
    data: {
      caseFileId,
      purpose: 'COURT_FEE',
      amountCents: BigInt(assessment.totalCents),
      payerUserId,
      payerPartyId,
      status: 'SUCCEEDED',
      operationRef,
      paidAt: at,
    },
  });
  return operationRef;
}

async function fillCase(content: DemoCaseContent, ctx: SeedCaseContext): Promise<boolean> {
  const db = getDb();
  const courtKey: DemoCourtKey = content.caseType === 'APPEAL_COMMERCIAL' ? 'appeal' : 'firstInstance';
  const row = await db.caseFile.findFirst({
    where: { courtId: ctx.courtIds[courtKey], number: content.number, isDemo: true },
    include: { court: { select: { name: true } }, _count: { select: { parties: true } }, nextHearing: { select: { startsAt: true } } },
  });
  if (!row || row._count.parties > 0) return false;

  const now = clock.now();
  const panelId = ctx.panelIds[content.panel];
  const panel = await db.panel.findUnique({ where: { id: panelId }, select: { name: true } });
  const file: FileRow = {
    id: row.id,
    number: row.number,
    code: row.code,
    year: row.year,
    nationalRef: row.nationalRef,
    courtName: row.court.name,
    panelName: panel?.name ?? '',
  };
  const registeredAt = new Date(now.getTime() - 40 * DAY);
  const status = row.status;
  const stamped = status !== 'REGISTERED';
  const rapporteurUserId = content.rapporteur && stamped ? await userId(content.rapporteur) : null;

  // The parties, their addresses and their counsel.
  const parties: Party[] = [];
  for (const [index, p] of content.parties.entries()) {
    const id = randomUUID();
    const litigantUserId = p.litigant ? await userId('litigant') : null;
    await db.caseParty.create({
      data: {
        id,
        caseFileId: file.id,
        side: p.side,
        personKind: p.personKind,
        displayName: p.name,
        legalForm: p.legalForm ?? null,
        litigantUserId,
        eServiceAcceptedAt: p.litigant ? registeredAt : null,
        position: index + 1,
      },
    });
    await db.partyAddress.create({
      data: {
        partyId: id,
        kind: p.personKind === 'LEGAL' ? 'REGISTERED_OFFICE' : 'DOMICILE',
        value: p.address,
        source: p.addressSource,
        withinCourtDistrict: true,
        validFrom: registeredAt,
      },
    });
    if (p.litigant) {
      await db.partyAddress.create({ data: { partyId: id, kind: 'ELECTRONIC', value: demoEmail('litigant'), source: 'PLATFORM', validFrom: registeredAt } });
    }
    if (p.counsel) {
      await db.representation.create({
        data: { partyId: id, lawyerUserId: await userId(p.counsel), startedAt: registeredAt, accountServiceConsentAt: registeredAt },
      });
    }
    parties.push({ id, key: p.key, name: p.name });
  }
  const party = (key: string): Party => {
    const found = parties.find((p) => p.key === key);
    if (!found) throw new Error(`demo party missing: ${key}`);
    return found;
  };
  const first = parties[0];
  const second = parties[1];
  if (!first || !second) throw new Error('a demo file needs two parties');
  for (const c of content.claims) {
    await db.claim.create({
      data: {
        caseFileId: file.id,
        partyId: party(c.party).id,
        category: c.category,
        nature: c.nature,
        amountCents: c.dirhams === null ? null : BigInt(c.dirhams * 100),
        filedAt: registeredAt,
      },
    });
  }

  // What the first party's counsel deposited, and the court fee.
  const firstCounsel = content.parties[0]?.counsel ?? 'lawyer.plaintiff';
  const firstCounselId = await userId(firstCounsel);
  const appeal = content.caseType === 'APPEAL_COMMERCIAL';
  const application = await storeDocument({
    caseFileId: file.id,
    bytes: depositedPdf(appeal ? 'appeal' : 'application'),
    mediaType: 'application/pdf',
    docType: 'APPLICATION',
    title: appeal ? DEMO_TEXTS.appealTitle : DEMO_TEXTS.applicationTitle,
    visibility: 'CASE',
    channel: 'ELECTRONIC',
    declaredNature: 'ORIGINAL',
    generated: false,
    depositedByUserId: firstCounselId,
    depositedByPartyId: first.id,
  });
  const exhibit = await storeDocument({
    caseFileId: file.id,
    bytes: depositedPdf('exhibit'),
    mediaType: 'application/pdf',
    docType: 'EXHIBIT',
    title: DEMO_TEXTS.exhibitTitle,
    visibility: 'CASE',
    channel: 'ELECTRONIC',
    declaredNature: 'CERTIFIED_COPY',
    generated: false,
    depositedByUserId: firstCounselId,
    depositedByPartyId: first.id,
  });
  const paymentRef = await courtFee(file.id, content, first.id, firstCounselId, registeredAt);
  const fee = await db.payment.findFirst({ where: { caseFileId: file.id, operationRef: paymentRef }, select: { amountCents: true } });
  const counselName = (await db.user.findUnique({ where: { id: firstCounselId }, select: { fullName: true } }))?.fullName ?? '';
  await generated(
    file,
    'registration-receipt',
    t('documents.title.registration-receipt'),
    {
      filingName: appeal ? DEMO_TEXTS.appealTitle : DEMO_TEXTS.applicationTitle,
      firstInstance: appeal ? [] : [{}],
      appeal: appeal ? [{}] : [],
      depositor: counselName,
      depositDate: formatMoroccoDate(registeredAt),
      depositTime: formatMoroccoTime(registeredAt),
      exhibits: [
        { title: appeal ? DEMO_TEXTS.appealTitle : DEMO_TEXTS.applicationTitle, nature: t('case.nature.ORIGINAL'), hash: application.sha256 },
        { title: DEMO_TEXTS.exhibitTitle, nature: t('case.nature.CERTIFIED_COPY'), hash: exhibit.sha256 },
      ],
      paymentRef,
      feeAmount: dirhamsText(fee?.amountCents ?? 0n),
    },
    [],
    'CASE',
    'RECEIPT',
  );

  const facts: string[] = [];
  const history: [string, string, string][] = [];
  const hearingDay = row.nextHearing ? formatMoroccoDate(row.nextHearing.startsAt) : '';
  if (stamped) history.push(['case.registration.stamp', 'REGISTERED', 'RAPPORTEUR_ASSIGNED'], ['case.rapporteur.confirm', 'RAPPORTEUR_ASSIGNED', 'RAPPORTEUR_ASSIGNED']);
  if (stamped && row.nextHearing) history.push(['case.hearing.set', 'RAPPORTEUR_ASSIGNED', 'RAPPORTEUR_ASSIGNED']);
  if (stamped && status !== 'RAPPORTEUR_ASSIGNED') history.push([appeal ? 'case.appeal.order-service' : 'case.summons.order', 'RAPPORTEUR_ASSIGNED', 'IN_NOTIFICATION']);

  // The summons order, signed by the judge who gave it.
  if (stamped && rapporteurUserId && content.rapporteur) {
    const rapporteurRole: RoleCode = appeal ? 'COUNSELLOR_RAPPORTEUR' : 'JUDGE_RAPPORTEUR';
    const judge = await signer(content.rapporteur, rapporteurRole);
    const summonsId = await generated(
      file,
      'order',
      DEMO_TEXTS.summonsTitle,
      { judgeName: judge.name, judgeRole: t(`roles.${judge.role}`), basis: basisText('case.summons.order'), paragraphs: [{ text: DEMO_TEXTS.summons.replace('{date}', hearingDay) }] },
      [judge],
      'CASE',
      'ORDER',
    );
    if (summonsId) await circle(summonsId, 'ORDER', [judge], 1, ctx.signingSecret);
  }

  const served = new Date(now.getTime() - 4 * DAY);
  const bailiff = await userId('bailiff.first');
  const servedFacts = new Map<string, string[]>();
  const addPartyFact = (partyId: string, fact: string) => servedFacts.set(partyId, [...(servedFacts.get(partyId) ?? []), fact]);

  if (status === 'IN_NOTIFICATION') {
    await db.envelope.create({
      data: { caseFileId: file.id, partyId: second.id, purpose: 'SUMMONS', channel: 'BAILIFF', agentUserId: bailiff, status: 'READY', createdAt: now },
    });
    facts.push('ENVELOPES_READY');
  } else if (stamped && status !== 'RAPPORTEUR_ASSIGNED') {
    for (const p of parties.slice(1)) {
      const electronic = content.parties.find((c) => c.key === p.key)?.litigant === true;
      await db.envelope.create({
        data: {
          caseFileId: file.id,
          partyId: p.id,
          purpose: appeal ? 'APPEAL' : 'SUMMONS',
          channel: electronic ? 'ELECTRONIC' : 'BAILIFF',
          agentUserId: electronic ? null : bailiff,
          status: 'SERVED',
          dispatchedAt: new Date(registeredAt.getTime() + 3 * DAY),
          servedAt: new Date(registeredAt.getTime() + 6 * DAY),
          createdAt: new Date(registeredAt.getTime() + 2 * DAY),
        },
      });
      addPartyFact(p.id, 'SERVED');
    }
    history.push(['case.envelopes.dispatch', 'IN_NOTIFICATION', 'IN_PREPARATION']);
  }

  if (status === 'IN_PREPARATION' && !appeal) {
    const defenseCounsel = content.parties[1]?.counsel;
    if (defenseCounsel) {
      await storeDocument({
        caseFileId: file.id,
        bytes: depositedPdf('brief'),
        mediaType: 'application/pdf',
        docType: 'BRIEF',
        title: DEMO_TEXTS.briefTitle,
        visibility: 'CASE',
        channel: 'ELECTRONIC',
        declaredNature: 'ORIGINAL',
        generated: false,
        depositedByUserId: await userId(defenseCounsel),
        depositedByPartyId: second.id,
      });
      history.push(['case.brief.file', 'IN_PREPARATION', 'IN_PREPARATION']);
    }
  }

  if (status === 'IN_EXPERTISE' && content.rapporteur) {
    const judge = await signer(content.rapporteur, 'JUDGE_RAPPORTEUR');
    const orderId = await generated(
      file,
      'order',
      DEMO_TEXTS.expertiseTitle,
      { judgeName: judge.name, judgeRole: t(`roles.${judge.role}`), basis: basisText('case.investigation.order'), paragraphs: [{ text: DEMO_TEXTS.expertise }, { text: DEMO_TEXTS.deposit }] },
      [judge],
      'CASE',
      'ORDER',
    );
    if (orderId) await circle(orderId, 'ORDER', [judge], 1, ctx.signingSecret);
    await db.investigation.create({
      data: {
        caseFileId: file.id,
        kind: 'EXPERTISE',
        expertUserId: await userId('expert.accounting'),
        depositAmountCents: 800_000n,
        depositPartyId: first.id,
        createdAt: served,
      },
    });
    facts.push('INVESTIGATION_ONGOING');
    addPartyFact(first.id, 'DEPOSIT_DUE');
    await timeLimit(file.id, 'INVESTIGATION_DEPOSIT', first.id, served, true);
    await timeLimit(file.id, 'EXPERT_CHALLENGE', second.id, served, true);
    history.push(['case.investigation.order', 'IN_PREPARATION', 'IN_EXPERTISE']);
  }

  if (status === 'IN_DELIBERATION' || status === 'JUDGMENT_ISSUED') {
    const pronounced = status === 'JUDGMENT_ISSUED';
    const panelKey: DemoPanelKey = content.panel;
    const signers = pronounced
      ? [await signer('panel.president', 'PANEL_PRESIDENT', ctx.panelIds[panelKey]), await signer('judge.rapporteur', 'JUDGE_RAPPORTEUR', ctx.panelIds[panelKey]), await signer('clerk.hearing', 'CLERK_HEARING')]
      : [await signer('judge.rapporteur', 'PANEL_PRESIDENT', ctx.panelIds[panelKey]), await signer('clerk.hearing', 'CLERK_HEARING')];
    const pronouncedAt = new Date(now.getTime() - 6 * DAY);
    const defendants = parties.slice(1).map((p) => p.name).join(DEMO_TEXTS.nameJoiner);
    const judgmentId = await generated(
      file,
      'judgment',
      DEMO_TEXTS.judgmentTitle,
      {
        courtName: file.courtName,
        panelName: file.panelName,
        pronouncementDate: pronounced ? formatMoroccoDate(pronouncedAt) : hearingDay,
        plaintiff: first.name,
        defendants,
        plaintiffQuality: content.judgment?.plaintiffQuality ?? '',
        defendantsQuality: content.judgment?.defendantsQuality ?? '',
        facts: (content.judgment?.facts ?? []).map((text) => ({ text })),
        reasoning: (content.judgment?.reasoning ?? []).map((text) => ({ text })),
        operative: (content.judgment?.operative ?? []).map((text) => ({ text })),
      },
      signers,
      pronounced ? 'CASE' : 'PANEL',
      'JUDGMENT',
    );
    const circleId = judgmentId ? await circle(judgmentId, 'JUDGMENT', signers, pronounced ? signers.length : 1, ctx.signingSecret) : null;
    await db.decision.create({
      data: {
        caseFileId: file.id,
        kind: 'JUDGMENT',
        subjectCode: 'MERITS',
        documentId: judgmentId,
        signatureCircleId: circleId,
        issuedAt: pronounced ? pronouncedAt : now,
        pronouncedAt: pronounced ? pronouncedAt : null,
      },
    });
    facts.push('MINUTES_SIGNED', 'JUDGMENT_DRAFTED');
    history.push(['case.hearing.reserve', 'READY', 'IN_DELIBERATION'], ['case.judgment.draft', 'IN_DELIBERATION', 'IN_DELIBERATION']);
    if (pronounced) {
      history.push(['case.judgment.pronounce', 'IN_DELIBERATION', 'JUDGMENT_ISSUED']);
      addPartyFact(first.id, 'JUDGMENT_CREDITOR');
      // The judgment served: through the litigant's account, and by a bailiff.
      for (const [index, p] of parties.slice(1).entries()) {
        const electronic = content.parties.find((c) => c.key === p.key)?.litigant === true;
        const servedAt = new Date(now.getTime() - (electronic ? 4 : 2) * DAY);
        await db.envelope.create({
          data: {
            caseFileId: file.id,
            partyId: p.id,
            purpose: 'JUDGMENT',
            channel: electronic ? 'ELECTRONIC' : 'BAILIFF',
            agentUserId: electronic ? null : bailiff,
            status: 'SERVED',
            dispatchedAt: new Date(servedAt.getTime() - DAY),
            servedAt,
            documentId: judgmentId,
            createdAt: new Date(servedAt.getTime() - (index + 2) * DAY),
          },
        });
        addPartyFact(p.id, 'JUDGMENT_SERVED');
        await timeLimit(file.id, 'APPEAL', p.id, servedAt, electronic);
      }
    } else {
      await db.caseFile.update({ where: { id: file.id }, data: { pronouncementDate: row.nextHearing ? moroccoDay(row.nextHearing.startsAt) : null } });
    }
  }

  for (const [partyId, partyFacts] of servedFacts) {
    await db.caseParty.update({ where: { id: partyId }, data: { facts: partyFacts } });
  }
  await db.caseFile.update({
    where: { id: file.id },
    data: {
      kind: appeal ? 'APPEAL' : 'FIRST_INSTANCE',
      caseType: content.caseType,
      subject: content.subject,
      panelId,
      rapporteurUserId,
      procedure: 'WRITTEN',
      registeredAt,
      registrationStampedAt: stamped ? new Date(registeredAt.getTime() + DAY) : null,
      facts,
    },
  });
  await transitions(file.id, history);
  return true;
}

function dirhamsText(cents: bigint): string {
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  // Centimes only when there are some (glossary rule 7: «486.000 درهم»).
  const fraction = cents % 100n;
  return t('case.amount', { amount: fraction === 0n ? whole : `${whole},${fraction.toString().padStart(2, '0')}` });
}

/** Fills every demo case file not yet filled; returns how many were filled. */
export async function seedCaseContent(ctx: SeedCaseContext): Promise<number> {
  // The demo signing secret is the demo password (decision recorded in docs/decisions.md).
  for (const key of ['judge.rapporteur', 'panel.president', 'clerk.hearing', 'counsellor.rapporteur', 'judge.in-charge']) {
    const id = await userId(key);
    const existing = await getDb().signingCredential.findUnique({ where: { userId: id }, select: { id: true } });
    if (!existing) await setSigningSecret(id, ctx.signingSecret);
  }
  let filled = 0;
  for (const content of DEMO_CASE_CONTENT) {
    if (await fillCase(content, ctx)) filled += 1;
  }
  return filled;
}
