// Case kinds and procedural states (study, «المسطرة آلة حالات»; prompt, «النواة»).
// The twelve states are the study's; each kind of file uses its own subset, in
// the order of the procedure. The Prisma enum CaseStatus must list exactly the
// same codes (an architecture test compares them, review A-16).

export const CASE_STATUSES = [
  'FILED',
  'REGISTERED',
  'RAPPORTEUR_ASSIGNED',
  'IN_NOTIFICATION',
  'IN_PREPARATION',
  'IN_EXPERTISE',
  'READY',
  'IN_DELIBERATION',
  'JUDGMENT_ISSUED',
  'UNDER_APPEAL',
  'IN_ENFORCEMENT',
  'CLOSED',
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_KINDS = ['FIRST_INSTANCE', 'APPEAL', 'ENFORCEMENT'] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

/** The states each kind of file goes through. */
export const STATUSES_OF_KIND: Readonly<Record<CaseKind, readonly CaseStatus[]>> = {
  FIRST_INSTANCE: CASE_STATUSES,
  APPEAL: CASE_STATUSES.filter((s) => s !== 'IN_ENFORCEMENT'),
  ENFORCEMENT: ['REGISTERED', 'IN_ENFORCEMENT', 'CLOSED'],
};

export function isCaseStatus(value: unknown): value is CaseStatus {
  return typeof value === 'string' && (CASE_STATUSES as readonly string[]).includes(value);
}

/** The states from `from` to `to`, both included, in the order of the procedure. */
export function statusesBetween(from: CaseStatus, to: CaseStatus): readonly CaseStatus[] {
  const start = CASE_STATUSES.indexOf(from);
  const end = CASE_STATUSES.indexOf(to);
  if (start < 0 || end < start) throw new Error(`invalid status range ${from}..${to}`);
  return CASE_STATUSES.slice(start, end + 1);
}

export function statusLabelKey(status: CaseStatus): string {
  return `states.${status}`;
}
