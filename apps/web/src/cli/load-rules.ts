// Loads the dated rule tables of rules/*.json into RuleSet (release step and
// demo seed), with the OWNER connection: the runtime role may read the table
// and never write it. Each new version is recorded in the event log. An
// existing version is never rewritten: a changed content under the same version
// stops the release.
import pg from 'pg';
import { z } from 'zod';
import { closeDb } from '@/server/db';
import { appendStandaloneEvent } from '@/server/events/append';
import { ruleSourceFiles, type RuleKind } from '@/server/rules/store';

const env = z.object({ MIGRATION_DATABASE_URL: z.string().min(1) }).safeParse(process.env);
if (!env.success) {
  console.error(JSON.stringify({ level: 'error', msg: 'load-rules refused', code: 'NO_OWNER_CONNECTION' }));
  process.exit(1);
}

const client = new pg.Client({ connectionString: env.data.MIGRATION_DATABASE_URL });
await client.connect();
const loaded: { kind: RuleKind; version: string; contentSha256: string }[] = [];
try {
  for (const table of ruleSourceFiles()) {
    const existing = await client.query<{ sha: string }>('SELECT "contentSha256" AS sha FROM "RuleSet" WHERE kind = $1 AND version = $2', [
      table.kind,
      table.version,
    ]);
    const row = existing.rows[0];
    if (row) {
      if (row.sha !== table.contentSha256) {
        console.error(JSON.stringify({ level: 'error', msg: 'load-rules refused', code: 'RULE_TABLE_CHANGED', kind: table.kind, version: table.version }));
        process.exit(1);
      }
      continue;
    }
    await client.query(
      `INSERT INTO "RuleSet" (id, kind, version, "validFrom", "validTo", "contentSha256", content, "loadedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, now())`,
      [table.kind, table.version, table.validFrom, table.validTo, table.contentSha256, JSON.stringify(table.content)],
    );
    loaded.push({ kind: table.kind, version: table.version, contentSha256: table.contentSha256 });
  }
} finally {
  await client.end();
}
for (const table of loaded) await appendStandaloneEvent({ action: 'rules.loaded', details: table });
await closeDb();
console.log(JSON.stringify({ level: 'info', msg: 'rule tables ready', loaded: loaded.length }));
