// What a list asks of the database before the core decides each of its rows
// (independent review IR-11). A list never takes the newest files and filters
// them, which drops the files waiting longest: it selects, in its query, the
// files the subject is related to and those in the state where an act awaits
// him, read from the very tables the single authorization function reads (the
// holders of «case.view», the procedure's table). Nothing here is written for
// a role.
//
// A scope is a list of branches, a file being in the scope when it is in one
// of them. A branch states the relations the subject must hold with the file,
// the statuses and kinds of file (null: any), and the conditions of the act.
// The server translates into its query what it can read from the file's
// columns, and leaves out the rest, so that the query selects at least every
// file the core would grant; the core still decides each row shown.
import { ACTIONS, isActionCode } from './actions';
import type { Condition, Holder, Relation } from './procedure/conditions';
import type { CaseKind, CaseStatus } from './procedure/states';
import { PROCEDURE_ACTIONS, type ProcedureAction } from './procedure/transitions';
import type { UserSubject } from './subject';

export interface ScopeBranch {
  /** all of them must hold */
  readonly relations: readonly Relation[];
  /** the file's status is one of them; null for any */
  readonly statuses: readonly CaseStatus[] | null;
  /** the file's kind is one of them; null for any */
  readonly kinds: readonly CaseKind[] | null;
  /** the conditions of the act on the file */
  readonly when: readonly Condition[];
}

/** The files a list may select: those of any branch; none when empty. */
export type FileScope = readonly ScopeBranch[];

const heldBy = (subject: UserSubject) => (holder: Holder) => holder.roles.includes(subject.role);

function actionBranches(subject: UserSubject, action: ProcedureAction): ScopeBranch[] {
  return action.holders
    .filter(heldBy(subject))
    .map((holder) => ({ relations: holder.relations, statuses: action.statuses, kinds: action.kinds, when: action.when }));
}

/** The files the subject may open («case.view»): one branch per relation through which its role opens a file. */
export function viewScope(subject: UserSubject): FileScope {
  return (ACTIONS['case.view'].caseHolders ?? [])
    .filter(heldBy(subject))
    .map((holder) => ({ relations: holder.relations, statuses: null, kinds: null, when: [] }));
}

/**
 * The files in which an act awaits the subject («ينتظر إجراء مني»): one branch
 * per awaited act on a file its role holds, with the act's statuses, kinds and
 * conditions.
 */
export function awaitedScope(subject: UserSubject): FileScope {
  return PROCEDURE_ACTIONS.filter((action) => action.resource === 'case' && action.awaited).flatMap((action) => actionBranches(subject, action));
}

/** The files in which the subject may do one act of the procedure on a file; none for any other code. */
export function actionScope(subject: UserSubject, code: string): FileScope {
  const action = isActionCode(code) ? ACTIONS[code]?.procedure : undefined;
  return action?.resource === 'case' ? actionBranches(subject, action) : [];
}
