import 'server-only';
import {
  moroccoDay,
  startOfMoroccoDay,
  subjectMayHold,
  viewScope,
  type CaseFact,
  type Condition,
  type DeadlineCode,
  type DeadlineState,
  type FileScope,
  type PartyCondition,
  type PartyFact,
  type Relation,
  type ScopeBranch,
  type UserSubject,
} from '@mahkama/core';
import type { Prisma } from '@/generated/prisma/client';
import { DERIVED_CASE_FACTS, INVESTIGATION_FACT_COLUMNS, JUDGMENT_DECISION_KINDS } from './snapshot';

// The query of a list (independent review IR-11; decisions 75 and 76): a scope
// of the core (packages/core/src/scope.ts) translated into a where clause on
// CaseFile. Every relation, status, kind and condition of the table is read
// from the data the snapshot reads it from (snapshot.ts): the file's columns,
// its stored facts, the latest investigation (as the database marks it), the
// hearing on the platform's day, the parties' facts and time limits, the
// judgment's signature circle. Nothing is left out, so that the query selects
// the files the core grants and no other, and a page holds what it counts; the
// core still decides each row shown. What a relation asks of the subject alone
// is the core's (subjectMayHold). Nothing here decides by role.
//
// Every list is bound by the files the subject may open (case.view): the two
// exported translations always add viewScope. Each part of a where clause is
// written so that its negation (outsideScopeWhere) is the files where it does
// not hold: a nullable column is compared only once it is known not to be null.

type Where = Prisma.CaseFileWhereInput;
type PartyWhere = Prisma.CasePartyWhereInput;
type LimitWhere = Prisma.TimeLimitWhereInput;

/** A where clause no file satisfies. */
const NOTHING: Where = { id: { in: [] } };

/** The platform's time, and its day in Morocco, for the facts that depend on them. */
interface At {
  readonly now: Date;
  readonly day: string;
  readonly dayStart: Date;
}

function at(now: Date): At {
  const day = moroccoDay(now);
  return { now, day, dayStart: startOfMoroccoDay(day) };
}

/** A fact of the file's next hearing (snapshot.ts): held; else to come; else in session if on the platform's day. */
function hearingFact(hearing: (t: At) => Prisma.HearingWhereInput) {
  return (t: At) => ({
    holds: { AND: [{ nextHearingId: { not: null } }, { nextHearing: { is: hearing(t) } }] },
    not: { OR: [{ nextHearingId: null }, { nextHearing: { is: { NOT: hearing(t) } } }] },
  });
}

/** A fact of the judgment (the decision of a judgment's kind) or of its signature circle. */
function judgmentFact(decision: Prisma.DecisionWhereInput) {
  const where: Where = { decisions: { some: { kind: { in: [...JUDGMENT_DECISION_KINDS] }, ...decision } } };
  return () => ({ holds: where, not: { NOT: where } });
}

/** A fact of the latest investigation, from its column. */
function investigationFact(column: (typeof INVESTIGATION_FACT_COLUMNS)[keyof typeof INVESTIGATION_FACT_COLUMNS]) {
  const where: Where = { investigations: { some: { latest: true, [column]: { not: null } } } };
  return () => ({ holds: where, not: { NOT: where } });
}

/** A fact read from a column's moment: set or not. */
function momentFact(column: 'registrationStampedAt' | 'referredToProsecutionAt' | 'referredToCommissionerAt') {
  return () => ({ holds: { [column]: { not: null } } as Where, not: { [column]: null } as Where });
}

/** Every derived fact (snapshot.ts, DERIVED_CASE_FACTS), as the snapshot derives it. */
const DERIVED_WHERE: Readonly<Record<string, (t: At) => { readonly holds: Where; readonly not: Where }>> = {
  REGISTRATION_STAMPED: momentFact('registrationStampedAt'),
  REFERRED_TO_PROSECUTION: momentFact('referredToProsecutionAt'),
  REFERRED_TO_COMMISSIONER: momentFact('referredToCommissionerAt'),
  ELECTRONIC_DOCUMENT: () => {
    const where: Where = { documents: { some: { generated: false, channel: 'ELECTRONIC' } } };
    return { holds: where, not: { NOT: where } };
  },
  ENVELOPES_READY: () => {
    const where: Where = { envelopes: { some: { status: 'READY' } } };
    return { holds: where, not: { NOT: where } };
  },
  ...Object.fromEntries(Object.entries(INVESTIGATION_FACT_COLUMNS).map(([fact, column]) => [fact, investigationFact(column)])),
  HEARING_SET: () => ({ holds: { nextHearingId: { not: null } }, not: { nextHearingId: null } }),
  HEARING_HELD: hearingFact(() => ({ heldAt: { not: null } })),
  HEARING_UPCOMING: hearingFact((t) => ({ heldAt: null, startsAt: { gt: t.now } })),
  HEARING_IN_SESSION: hearingFact((t) => ({ heldAt: null, startsAt: { lte: t.now, gte: t.dayStart } })),
  PRONOUNCEMENT_DAY: (t) => ({
    holds: { AND: [{ pronouncementDate: { not: null } }, { pronouncementDate: t.day }] },
    not: { OR: [{ pronouncementDate: null }, { AND: [{ pronouncementDate: { not: null } }, { NOT: { pronouncementDate: t.day } }] }] },
  }),
  JUDGMENT_PRONOUNCED: judgmentFact({ pronouncedAt: { not: null } }),
  DECISION_FINAL: judgmentFact({ final: true }),
  PROVISIONAL_ENFORCEMENT: judgmentFact({ provisionalEnforcement: true }),
  // The guard of the circles lets one complete only with every signature (signature_circle_guard).
  SIGNATURES_COMPLETE: judgmentFact({ signatureCircle: { is: { status: 'COMPLETED' } } }),
  SIGNATURE_CIRCLE_OPEN: judgmentFact({ signatureCircle: { is: { status: 'OPEN' } } }),
};

// A derived fact the query cannot read would leave a condition out: refuse to load.
for (const fact of DERIVED_CASE_FACTS) {
  if (!Object.hasOwn(DERIVED_WHERE, fact)) throw new Error(`scope: no translation of the derived fact ${fact}`);
}

/**
 * The signers of a circle the query reads by position: beyond, a longer circle
 * is selected for each of its signers not yet signed, and the core decides.
 */
const SIGNERS_READ = 16;

/**
 * The circles in which the user signs next: he is the signer at the position
 * of the number of signatures, which are given in order from 0 (signCircle).
 */
function nextSignerCircle(userId: string): Prisma.SignatureCircleWhereInput {
  const at = (position: number): Prisma.SignatureCircleWhereInput => ({
    AND: [
      { signers: { path: [String(position), 'userId'], equals: userId } },
      ...(position > 0 ? [{ signatures: { some: { position: position - 1 } } }] : []),
      { signatures: { none: { position } } },
    ],
  });
  const beyond: Prisma.SignatureCircleWhereInput = {
    AND: [
      { signers: { path: [String(SIGNERS_READ), 'userId'], string_contains: '' } },
      { signers: { array_contains: [{ userId }] } },
      { signatures: { none: { signerUserId: userId } } },
    ],
  };
  return { status: 'OPEN', OR: [...Array.from({ length: SIGNERS_READ }, (_, position) => at(position)), beyond] };
}

/** The files in which the subject holds each relation, from what the snapshot reads; the record names every relation of the core. */
const RELATION_WHERE: Readonly<Record<Relation, (subject: UserSubject) => Where>> = {
  COUNSEL: ({ userId }) => ({ parties: { some: { representations: { some: { lawyerUserId: userId, endedAt: null } } } } }),
  RAPPORTEUR: ({ userId, courtId }) => (courtId ? { AND: [{ rapporteurUserId: { not: null } }, { rapporteurUserId: userId }, { courtId }] } : NOTHING),
  PANEL: ({ courtId, panelId }) => (courtId && panelId ? { AND: [{ panelId: { not: null } }, { panelId }, { courtId }] } : NOTHING),
  COURT_STAFF: ({ courtId }) => (courtId ? { courtId } : NOTHING),
  PROSECUTION: ({ courtId }) => (courtId ? { courtId, referredToProsecutionAt: { not: null } } : NOTHING),
  COMMISSIONER: ({ courtId }) => (courtId ? { courtId, referredToCommissionerAt: { not: null }, court: { specialty: 'ADMINISTRATIVE' } } : NOTHING),
  EXPERT: ({ userId }) => ({ investigations: { some: { latest: true, expertUserId: userId } } }),
  LITIGANT: ({ userId }) => ({ parties: { some: { litigantUserId: userId, OR: [{ eServiceAcceptedAt: { not: null } }, { facts: { has: 'E_SERVICE_ACCEPTED' } }] } } }),
  ADMIN_PARTY: ({ organizationId }) => (organizationId ? { parties: { some: { organizationId } } } : NOTHING),
  GARNISHEE: ({ organizationId }) => (organizationId ? { enforcement: { some: { kind: 'GARNISHMENT', organizationId } } } : NOTHING),
  NEXT_SIGNER: ({ userId }) => ({
    decisions: { some: { kind: { in: [...JUDGMENT_DECISION_KINDS] }, signatureCircleId: { not: null }, signatureCircle: { is: nextSignerCircle(userId) } } },
  }),
  // A list never holds the summons code: only the request that presents it does.
  SUMMONS_HOLDER: () => NOTHING,
  // The bailiff acts on an envelope, never on a file through this relation.
  AGENT: () => NOTHING,
  // The snapshot reads no signer of the minutes nor any accreditation before the Court of Cassation yet:
  // the core grants neither, and the query selects neither (snapshot.ts).
  MINUTES_SIGNER: () => NOTHING,
  CASSATION_ACCREDITED: () => NOTHING,
};

/**
 * A time limit's state, as deadlineState reads the limits of the given code
 * (core, procedure/conditions.ts): open while one runs and has not ended;
 * elapsed when none is open and one elapsed or ended running; not elapsed
 * when one is open or there is none.
 */
function limitState<W extends Where | PartyWhere>(state: DeadlineState, code: DeadlineCode, now: Date, some: (limit: LimitWhere) => W, none: W): W {
  const open = some({ ruleCode: code, status: 'RUNNING', endsAt: { gt: now } });
  if (state === 'OPEN') return open;
  if (state === 'ELAPSED') return { AND: [{ NOT: open }, some({ ruleCode: code, OR: [{ status: 'ELAPSED' }, { status: 'RUNNING', endsAt: { lte: now } }] })] } as W;
  return { OR: [open, none] } as W;
}

function partyFactWhere(fact: PartyFact, holds: boolean): PartyWhere {
  // E_SERVICE_ACCEPTED is also read from the moment of the acceptance (snapshot.ts).
  if (fact === 'E_SERVICE_ACCEPTED') {
    return holds
      ? { OR: [{ eServiceAcceptedAt: { not: null } }, { facts: { has: fact } }] }
      : { AND: [{ eServiceAcceptedAt: null }, { NOT: { facts: { has: fact } } }] };
  }
  return holds ? { facts: { has: fact } } : { NOT: { facts: { has: fact } } };
}

function partyWhere(condition: PartyCondition, t: At): PartyWhere {
  const parts: PartyWhere[] = [
    ...(condition.sides ? [{ side: { in: [...condition.sides] } }] : []),
    ...(condition.facts ?? []).map((fact) => partyFactWhere(fact, true)),
    ...(condition.notFacts ?? []).map((fact) => partyFactWhere(fact, false)),
    ...(condition.deadline
      ? [
          limitState<PartyWhere>(condition.deadline.state, condition.deadline.code, t.now, (limit) => ({ timeLimits: { some: limit } }), {
            timeLimits: { none: { ruleCode: condition.deadline.code } },
          }),
        ]
      : []),
    ...(condition.anyOf ? [{ OR: condition.anyOf.map((c) => partyWhere(c, t)) }] : []),
  ];
  return { AND: parts };
}

/** The parties the subject acts for (core, clientParties): those he represents, or his own. */
const clientOf = ({ userId }: UserSubject): PartyWhere => ({
  OR: [{ representations: { some: { lawyerUserId: userId, endedAt: null } } }, { AND: [{ litigantUserId: { not: null } }, { litigantUserId: userId }] }],
});

function conditionWhere(condition: Condition, subject: UserSubject, t: At): Where {
  if ('fact' in condition || 'notFact' in condition) {
    const holds = 'fact' in condition;
    const fact: CaseFact = holds ? condition.fact : condition.notFact;
    if (DERIVED_CASE_FACTS.has(fact)) {
      const derived = DERIVED_WHERE[fact];
      // Never leave a condition out: the list would count files where nothing awaits.
      if (!derived) throw new Error(`scope: no translation of the derived fact ${fact}`);
      const where = derived(t);
      return holds ? where.holds : where.not;
    }
    return holds ? { facts: { has: fact } } : { NOT: { facts: { has: fact } } };
  }
  if ('anyOf' in condition) return { OR: condition.anyOf.map((c) => conditionWhere(c, subject, t)) };
  if ('deadline' in condition) {
    return limitState<Where>(condition.state, condition.deadline, t.now, (limit) => ({ timeLimits: { some: { partyId: null, ...limit } } }), {
      timeLimits: { none: { ruleCode: condition.deadline, partyId: null } },
    });
  }
  if ('clientParty' in condition) return { parties: { some: { AND: [clientOf(subject), partyWhere(condition.clientParty, t)] } } };
  if ('anyParty' in condition) return { parties: { some: partyWhere(condition.anyParty, t) } };
  if ('rapporteur' in condition) return { rapporteurUserId: condition.rapporteur === 'NONE' ? null : { not: null } };
  return { court: { specialty: 'ADMINISTRATIVE' } };
}

function branchWhere(subject: UserSubject, branch: ScopeBranch, t: At): Where {
  if (!branch.relations.every((relation) => subjectMayHold(subject, relation))) return NOTHING;
  const relations = branch.relations.map((relation) => RELATION_WHERE[relation](subject));
  if (relations.includes(NOTHING)) return NOTHING;
  return {
    AND: [
      ...relations,
      ...(branch.statuses ? [{ status: { in: [...branch.statuses] } }] : []),
      ...(branch.kinds ? [{ kind: { in: [...branch.kinds] } }] : []),
      ...branch.when.map((condition) => conditionWhere(condition, subject, t)),
    ],
  };
}

/** The files of one scope, unbounded: never a list's where clause by itself, which is why it is not exported. */
function scopeWhere(subject: UserSubject, scope: FileScope, t: At): Where {
  const branches = scope.map((branch) => branchWhere(subject, branch, t)).filter((where) => where !== NOTHING);
  return branches.length === 0 ? NOTHING : { OR: branches };
}

/**
 * What awaits an act, the oldest first (decision 75): by the moment the file
 * was registered, one without it first, then by its creation; the identifier
 * makes the order stable from one page to the next.
 */
export const OLDEST_FIRST: readonly Prisma.CaseFileOrderByWithRelationInput[] = [
  { registeredAt: { sort: 'asc', nulls: 'first' } },
  { createdAt: 'asc' },
  { id: 'asc' },
];

/** The files the subject may open (case.view) that are in every scope given, at the platform's time. */
export function scopesWhere(subject: UserSubject, now: Date, ...scopes: readonly FileScope[]): Where {
  const t = at(now);
  return { AND: [viewScope(subject), ...scopes].map((scope) => scopeWhere(subject, scope, t)) };
}

/** The files the subject may open (case.view) that are outside the scope given, at the platform's time. */
export function outsideScopeWhere(subject: UserSubject, now: Date, scope: FileScope): Where {
  const t = at(now);
  return { AND: [scopeWhere(subject, viewScope(subject), t), { NOT: scopeWhere(subject, scope, t) }] };
}
