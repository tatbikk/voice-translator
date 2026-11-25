// The dated rule tables of rules/*.json in the test database, loaded with the
// owner connection exactly as the release step loads them (src/cli/load-rules.ts),
// and the test court made the commercial model court the districts table names.
import { DEMO_REGISTER_ENTRIES } from '@/cli/seed-data/filings';
import { runBundled } from './cli';
import { sql } from './db';

/** Loads rules/*.json into RuleSet. Call after useFreshDatabase() has recreated the schema. */
export function loadRuleTables(): void {
  const result = runBundled('load-rules');
  if (result.status !== 0) throw new Error(`load-rules failed (${String(result.status)}): ${result.output}`);
}

/** The court code of rules/districts.json for the commercial model court of first instance. */
export const MODEL_COURT_CODE = 'demo-fi-commercial';

/**
 * Gives the test court the code and the specialty of the commercial model court,
 * and the simulated commercial register the companies of the model case, as the
 * seed does: the server keeps an address «from the register» only when the
 * register gives it (review P2-A-08).
 */
export async function makeModelCourt(courtId: string): Promise<void> {
  await sql(`UPDATE "Court" SET code = $2, specialty = 'COMMERCIAL' WHERE id = $1`, [courtId, MODEL_COURT_CODE]);
  for (const entry of DEMO_REGISTER_ENTRIES) {
    await sql(
      `INSERT INTO "SimulatedRegistryEntry" (id, registry, key, data) VALUES (gen_random_uuid(), 'COMMERCIAL_REGISTER', $1, $2::jsonb)
       ON CONFLICT (registry, key) DO NOTHING`,
      [entry.key, JSON.stringify(entry.data)],
    );
  }
}
