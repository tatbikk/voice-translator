// The dated rule tables of rules/*.json in the test database, loaded with the
// owner connection exactly as the release step loads them (src/cli/load-rules.ts),
// and the test court made the commercial model court the districts table names.
import { runBundled } from './cli';
import { sql } from './db';

/** Loads rules/*.json into RuleSet. Call after useFreshDatabase() has recreated the schema. */
export function loadRuleTables(): void {
  const result = runBundled('load-rules');
  if (result.status !== 0) throw new Error(`load-rules failed (${String(result.status)}): ${result.output}`);
}

/** The court code of rules/districts.json for the commercial model court of first instance. */
export const MODEL_COURT_CODE = 'demo-fi-commercial';

/** Gives the test court the code and the specialty of the commercial model court. */
export async function makeModelCourt(courtId: string): Promise<void> {
  await sql(`UPDATE "Court" SET code = $2, specialty = 'COMMERCIAL' WHERE id = $1`, [courtId, MODEL_COURT_CODE]);
}
