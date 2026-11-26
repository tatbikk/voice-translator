import 'server-only';
import type { CaseFact, Condition, FileScope, Relation, ScopeBranch, UserSubject } from '@mahkama/core';
import type { Prisma } from '@/generated/prisma/client';
import { DERIVED_CASE_FACTS } from './snapshot';

// The query of a list (independent review IR-11): a scope of the core
// (packages/core/src/scope.ts) translated into a where clause on CaseFile.
// Each relation, status, kind and condition is read from the column the
// snapshot reads it from (snapshot.ts); what no column holds (a party's facts
// or time limits, a fact derived from the latest investigation, the hearing's
// session, the signature circle) is left out of the query, so that the query
// selects at least every file the core would grant, and the core decides each
// row shown. Nothing here decides by role: the core chose the branches.

type Where = Prisma.CaseFileWhereInput;

/** A where clause no file satisfies. */
const NOTHING: Where = { id: { in: [] } };

/** Derived facts the query reads from a column of the file or a row of its own (the rest it cannot say). */
const DERIVED_WHERE: Partial<Record<CaseFact, { readonly holds: Where; readonly not: Where }>> = {
  REGISTRATION_STAMPED: { holds: { registrationStampedAt: { not: null } }, not: { registrationStampedAt: null } },
  REFERRED_TO_PROSECUTION: { holds: { referredToProsecutionAt: { not: null } }, not: { referredToProsecutionAt: null } },
  REFERRED_TO_COMMISSIONER: { holds: { referredToCommissionerAt: { not: null } }, not: { referredToCommissionerAt: null } },
  HEARING_SET: { holds: { nextHearingId: { not: null } }, not: { nextHearingId: null } },
  ENVELOPES_READY: { holds: { envelopes: { some: { status: 'READY' } } }, not: { envelopes: { none: { status: 'READY' } } } },
  ELECTRONIC_DOCUMENT: {
    holds: { documents: { some: { generated: false, channel: 'ELECTRONIC' } } },
    not: { documents: { none: { generated: false, channel: 'ELECTRONIC' } } },
  },
};

/**
 * The files in which the subject holds each relation; null when no column says
 * it (the core decides). The record names every relation of the core.
 */
const RELATION_WHERE: Readonly<Record<Relation, (subject: UserSubject) => Where | null>> = {
  COUNSEL: ({ userId }) => ({ parties: { some: { representations: { some: { lawyerUserId: userId, endedAt: null } } } } }),
  RAPPORTEUR: ({ userId, courtId }) => (courtId ? { rapporteurUserId: userId, courtId } : NOTHING),
  PANEL: ({ courtId, panelId }) => (courtId && panelId ? { panelId, courtId } : NOTHING),
  COURT_STAFF: ({ courtId }) => (courtId ? { courtId } : NOTHING),
  PROSECUTION: ({ courtId }) => (courtId ? { courtId, referredToProsecutionAt: { not: null } } : NOTHING),
  COMMISSIONER: ({ courtId }) => (courtId ? { courtId, referredToCommissionerAt: { not: null }, court: { specialty: 'ADMINISTRATIVE' } } : NOTHING),
  // The core reads the latest investigation's expert; the query, any of them.
  EXPERT: ({ userId }) => ({ investigations: { some: { expertUserId: userId } } }),
  LITIGANT: ({ userId }) => ({ parties: { some: { litigantUserId: userId, OR: [{ eServiceAcceptedAt: { not: null } }, { facts: { has: 'E_SERVICE_ACCEPTED' } }] } } }),
  ADMIN_PARTY: ({ organizationId }) => (organizationId ? { parties: { some: { organizationId } } } : NOTHING),
  GARNISHEE: ({ organizationId }) => (organizationId ? { enforcement: { some: { kind: 'GARNISHMENT', organizationId } } } : NOTHING),
  // A list never holds the summons code: only the request that presents it does.
  SUMMONS_HOLDER: () => NOTHING,
  // The bailiff acts on an envelope, never on a file through this relation.
  AGENT: () => NOTHING,
  // Read from the signature circle or the minutes: the core decides.
  NEXT_SIGNER: () => null,
  MINUTES_SIGNER: () => null,
  CASSATION_ACCREDITED: () => null,
};

/** The files in which the condition holds; null when no column says it (the core decides). */
function conditionWhere(condition: Condition): Where | null {
  if ('fact' in condition || 'notFact' in condition) {
    const holds = 'fact' in condition;
    const fact = holds ? condition.fact : condition.notFact;
    if (DERIVED_CASE_FACTS.has(fact)) {
      const derived = DERIVED_WHERE[fact];
      return derived ? (holds ? derived.holds : derived.not) : null;
    }
    return holds ? { facts: { has: fact } } : { NOT: { facts: { has: fact } } };
  }
  if ('anyOf' in condition) {
    const parts = condition.anyOf.map(conditionWhere);
    return parts.some((part) => part === null) ? null : { OR: parts as Where[] };
  }
  if ('rapporteur' in condition) return { rapporteurUserId: condition.rapporteur === 'NONE' ? null : { not: null } };
  if ('administrativeCourt' in condition) return { court: { specialty: 'ADMINISTRATIVE' } };
  // A time limit of the file or of a party, a party's side or facts: the core decides.
  return null;
}

function branchWhere(subject: UserSubject, branch: ScopeBranch): Where {
  const relations = branch.relations.map((relation) => RELATION_WHERE[relation](subject));
  if (relations.includes(NOTHING)) return NOTHING;
  const parts: Where[] = [
    ...relations.filter((where): where is Where => where !== null),
    ...(branch.statuses ? [{ status: { in: [...branch.statuses] } }] : []),
    ...(branch.kinds ? [{ kind: { in: [...branch.kinds] } }] : []),
    ...branch.when.map(conditionWhere).filter((where): where is Where => where !== null),
  ];
  return { AND: parts };
}

/** The files of the scope, as a where clause on CaseFile: none for an empty scope. */
export function scopeWhere(subject: UserSubject, scope: FileScope): Where {
  const branches = scope.map((branch) => branchWhere(subject, branch)).filter((where) => where !== NOTHING);
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

/** The files of every scope given: those the subject may open, and those in the state a list is about. */
export function scopesWhere(subject: UserSubject, ...scopes: readonly FileScope[]): Where {
  return { AND: scopes.map((scope) => scopeWhere(subject, scope)) };
}
