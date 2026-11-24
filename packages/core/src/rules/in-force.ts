// The rule in force on the day of an act (prompt, rule 5): a dated table
// applies from its validFrom (included) to its validTo (excluded). Days are
// calendar days in Morocco, written YYYY-MM-DD, so they compare as strings.

export interface Dated {
  readonly version: string;
  readonly validFrom: string;
  readonly validTo: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function ruleInForce<T extends Dated>(tables: readonly T[], day: string): T | null {
  if (!DAY.test(day)) throw new Error(`not a calendar day: ${day}`);
  const matching = tables.filter((t) => t.validFrom <= day && (t.validTo === null || day < t.validTo));
  if (matching.length > 1) throw new Error(`overlapping rule tables on ${day}: ${matching.map((t) => t.version).join(', ')}`);
  return matching[0] ?? null;
}
