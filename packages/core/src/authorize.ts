// The single authorization function (contract §4.2). Deny by default: an
// unknown action, a missing subject, a role not listed or a failed condition is
// a refusal. The server calls it on every request; the interface only displays
// what availableActions() returns, which is derived from the same table.
//
// Actions on a case file or an envelope are decided on the snapshot the server
// built for this request: a subject without any relation with the file is
// answered NOT_FOUND, as for a file that does not exist; a subject who knows
// the file but may not act is answered ROLE_NOT_PERMITTED or CONDITION_NOT_MET.
import { ACTIONS, CASE_VIEW_HOLDERS, COURT_SIDE_HOLDERS, isActionCode, type ActionRule } from './actions';
import { CONDITIONS } from './conditions';
import { conditionHolds, envelopeConditionHolds, holdsRelation, type Holder } from './procedure/conditions';
import type { CaseSnapshot } from './procedure/snapshot';
import { ROLES, type RoleCode } from './roles';
import type { AuthorizationContext, DocumentVisibility, Resource, Subject, UserSubject } from './subject';

export type DenyReason =
  | 'UNAUTHENTICATED'
  | 'ROLE_NOT_PERMITTED'
  | 'CONDITION_NOT_MET'
  | 'UNKNOWN_ACTION'
  | 'MODE_NOT_PERMITTED'
  | 'NOT_FOUND';

export type Decision =
  | { readonly allowed: true; readonly rule: ActionRule }
  | { readonly allowed: false; readonly reason: DenyReason };

/** Roles that may never read the content of a case file (rule 8 of the prompt). */
const NEVER_CASE_CONTENT: readonly RoleCode[] = ['SYSTEM_ADMIN', 'RULES_LEGAL_VALIDATOR'];
const CASE_SCOPED = /^(case|envelope)\./;

const deny = (reason: DenyReason): Decision => ({ allowed: false, reason });

function holds(subject: UserSubject, snapshot: CaseSnapshot, holder: Holder): boolean {
  return holder.roles.includes(subject.role) && holder.relations.every((r) => holdsRelation(subject, snapshot, r));
}

/**
 * Whether the subject knows the file at all: it may open the case page, or it
 * acts on the file from its own space (the expert on the mission, the bank on
 * the garnishment, a lawyer holding the summons code).
 */
export function knowsCase(subject: UserSubject, snapshot: CaseSnapshot): boolean {
  if (NEVER_CASE_CONTENT.includes(subject.role)) return false;
  if (CASE_VIEW_HOLDERS.some((h) => holds(subject, snapshot, h))) return true;
  return (['EXPERT', 'GARNISHEE', 'SUMMONS_HOLDER'] as const).some((r) => holdsRelation(subject, snapshot, r));
}

/**
 * Whether a document of the given visibility, deposited by the given user (null
 * for what the platform printed), may be shown to the subject. The application as
 * uploaded in Word is its depositor's and the court's (decision 71): the person
 * who deposited it, not his party's other counsel, and the judges and staff of
 * the file's court, not the prosecution nor the royal commissioner.
 */
export function documentVisible(
  subject: UserSubject,
  snapshot: CaseSnapshot,
  visibility: DocumentVisibility,
  documentId: string,
  depositorUserId: string | null,
): boolean {
  if (visibility === 'CASE') return true;
  if (visibility === 'DEPOSITOR_AND_COURT') {
    return (depositorUserId !== null && depositorUserId === subject.userId) || COURT_SIDE_HOLDERS.some((h) => holds(subject, snapshot, h));
  }
  const judge = holdsRelation(subject, snapshot, 'RAPPORTEUR');
  if (visibility === 'JUDGE') return judge;
  if (judge || holdsRelation(subject, snapshot, 'PANEL')) return true;
  // The signer whose turn it is sees the document he signs, not the rest of the panel's documents.
  return holdsRelation(subject, snapshot, 'NEXT_SIGNER') && (snapshot.nextSignerDocumentIds ?? []).includes(documentId);
}

/**
 * Whether the subject sees the identity numbers and the electronic contacts of
 * the parties of a file it knows (review P1-S-14): the court and counsel do; a
 * litigant, an administration or another participant sees those of its own
 * party only.
 */
export function seesPartyContacts(subject: UserSubject): boolean {
  return ROLES[subject.role].accountBasis === 'INTERNAL' || CONTACT_READERS.includes(subject.role);
}
const CONTACT_READERS: readonly RoleCode[] = ['LAWYER', 'LAWYER_ASSISTANT'];

/**
 * Whether the subject reads the notes of the registry office to the judge
 * (procedure/notes.ts): the registry office and the court president read them all; a judge
 * reads those addressed to him, and the rapporteur those of his file. A party
 * and its counsel never do, nor learn that one exists.
 */
export function readsRegistryNotes(subject: UserSubject, snapshot: CaseSnapshot, addressedToUserId: string | null): boolean {
  if (NOTE_READERS.includes(subject.role)) return true;
  if (addressedToUserId !== null && addressedToUserId === subject.userId) return true;
  return holdsRelation(subject, snapshot, 'RAPPORTEUR');
}
const NOTE_READERS: readonly RoleCode[] = ['CLERK_REGISTRATION', 'CHIEF_CLERK', 'COURT_PRESIDENT'];

function decideCaseScoped(rule: ActionRule, subject: UserSubject, resource: Resource | undefined, context: AuthorizationContext): Decision {
  if (NEVER_CASE_CONTENT.includes(subject.role)) return deny('NOT_FOUND');
  if (rule.resourceKind !== null && resource?.kind !== rule.resourceKind) return deny('NOT_FOUND');
  const procedure = rule.procedure;

  if (resource?.kind === 'envelope') {
    const envelope = resource.snapshot;
    if (subject.role !== 'BAILIFF' || envelope.agentUserId !== subject.userId) return deny('NOT_FOUND');
    if (!procedure) return deny('ROLE_NOT_PERMITTED');
    if (!context.now) throw new Error('authorize: platform time is required for an envelope');
    const now = context.now;
    if (!procedure.envelopeWhen.every((c) => envelopeConditionHolds(c, envelope, now))) return deny('CONDITION_NOT_MET');
    return { allowed: true, rule };
  }

  if (resource?.kind !== 'case' && resource?.kind !== 'case-document') return deny('NOT_FOUND');
  const snapshot = resource.snapshot;
  if (!knowsCase(subject, snapshot)) return deny('NOT_FOUND');

  if (!procedure) {
    // An access action (the case page, a document): its own holders, and for a
    // document its visibility. A document one may not see does not exist for him.
    const holders = rule.caseHolders ?? [];
    if (!holders.some((h) => holds(subject, snapshot, h))) return deny('NOT_FOUND');
    if (resource.kind === 'case-document' && !documentVisible(subject, snapshot, resource.visibility, resource.documentId, resource.depositorUserId)) return deny('NOT_FOUND');
    return { allowed: true, rule };
  }
  if (!context.now) throw new Error('authorize: platform time is required for a case file');
  const now = context.now;
  if (!procedure.holders.some((h) => h.roles.includes(subject.role))) return deny('ROLE_NOT_PERMITTED');
  if (!procedure.kinds.includes(snapshot.kind) || !procedure.statuses.includes(snapshot.status)) return deny('CONDITION_NOT_MET');
  if (!procedure.holders.some((h) => holds(subject, snapshot, h))) return deny('CONDITION_NOT_MET');
  if (!procedure.when.every((c) => conditionHolds(c, subject, snapshot, now))) return deny('CONDITION_NOT_MET');
  return { allowed: true, rule };
}

export function authorize(
  subject: Subject,
  action: string,
  resource: Resource | undefined,
  context: AuthorizationContext,
): Decision {
  if (!isActionCode(action)) return deny('UNKNOWN_ACTION');
  const rule = ACTIONS[action];
  if (!rule) return deny('UNKNOWN_ACTION');

  // Mode conditions are evaluated first: in production mode a demo action does
  // not exist, whoever asks.
  for (const code of rule.requires) {
    const condition = CONDITIONS[code];
    if (condition.onFail === 'MODE_NOT_PERMITTED' && !condition.test(subject, resource, context)) {
      return deny('MODE_NOT_PERMITTED');
    }
  }

  if (rule.holders !== 'ANY_VISITOR') {
    if (subject.kind !== 'user') return deny('UNAUTHENTICATED');
    if (CASE_SCOPED.test(action)) return decideCaseScoped(rule, subject, resource, context);
    if (rule.procedure) {
      // Actions outside a file (filing, the litigant's contact details): their resource, then their roles.
      if (resource?.kind !== rule.resourceKind) return deny('NOT_FOUND');
      if (!rule.procedure.holders.some((h) => h.roles.includes(subject.role))) return deny('ROLE_NOT_PERMITTED');
      if (resource.kind === 'own-contact' && resource.userId !== subject.userId) return deny('NOT_FOUND');
      return { allowed: true, rule };
    }
    if (rule.holders !== 'ANY_ACTIVE_USER' && !rule.holders.includes(subject.role)) {
      return deny('ROLE_NOT_PERMITTED');
    }
  }

  if (rule.resourceKind !== null && resource?.kind !== rule.resourceKind) {
    // An action applied to the wrong kind of resource, or without its resource.
    return deny('NOT_FOUND');
  }

  for (const code of rule.requires) {
    const condition = CONDITIONS[code];
    if (condition.onFail === 'MODE_NOT_PERMITTED') continue;
    if (!condition.test(subject, resource, context)) {
      return deny(condition.onFail === 'NOT_FOUND' ? 'NOT_FOUND' : 'CONDITION_NOT_MET');
    }
  }

  return { allowed: true, rule };
}

/**
 * The buttons the subject may use, on the given resource (or on none). This is
 * what the action bar displays; it can never contain an action that authorize()
 * would refuse, because it is computed by calling authorize().
 */
export function availableActions(
  subject: Subject,
  resource: Resource | undefined,
  context: AuthorizationContext,
): ActionRule[] {
  const kind = resource?.kind ?? null;
  return Object.values(ACTIONS).filter(
    (rule): rule is ActionRule => rule !== undefined && rule.button && rule.resourceKind === kind && authorize(subject, rule.code, resource, context).allowed,
  );
}
