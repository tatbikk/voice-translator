// Loads the dated rule tables of rules/*.json into RuleSet (release step and
// demo seed), with the OWNER connection: the runtime role may read the table
// and never write it.
// - Every file is first checked against the schema of its kind, and the
//   versions of one kind must not overlap: an invalid file stops the release
//   before anything is written (review P1-S-10).
// - The new versions and their events are written in ONE transaction, which
//   takes the event log's lock first: every version is loaded and recorded, or
//   none is (review P1-A-07). The loading time is the platform's clock.
// - An existing version is never rewritten: a changed content under the same
//   version stops the release. The one change accepted is the closing of a
//   version loaded open-ended, when a newer version takes over: its end date
//   is recorded, nothing else of it changes (rules.closed, review P1-A-18).
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { PrismaClient } from '@/generated/prisma/client';
import { clock } from '@/server/clock';
import { closeDb } from '@/server/db';
import { appendEvent, lockEventLog } from '@/server/events/append';
import { asJson } from '@/server/json';
import { ruleSourceFiles, type RuleKind } from '@/server/rules/store';
import { ruleFileProblems, storedVersionChange } from '@/server/rules/validation';

class Refused extends Error {
  constructor(readonly code: string, readonly fields: Readonly<Record<string, unknown>> = {}) {
    super(code);
    this.name = 'Refused';
  }
}

function refuse(error: Refused): void {
  console.error(JSON.stringify({ level: 'error', msg: 'load-rules refused', code: error.code, ...error.fields }));
  process.exitCode = 1;
}

async function load(ownerUrl: string): Promise<{ loaded: number; closed: number }> {
  const tables = ruleSourceFiles();
  const problems = ruleFileProblems(tables);
  if (problems.length > 0) throw new Refused('RULE_TABLE_INVALID', { problems });

  const owner = new PrismaClient({
    adapter: new PrismaPg({ connectionString: ownerUrl, max: 1, options: '-c statement_timeout=15000 -c lock_timeout=5000' }),
  });
  try {
    await clock.refresh();
    return await owner.$transaction(
      async (tx) => {
        await lockEventLog(tx);
        const at = clock.now();
        const stored = await tx.ruleSet.findMany({ select: { id: true, kind: true, version: true, validTo: true, contentSha256: true } });
        const closing: { id: string; previousSha256: string; validTo: string; table: (typeof tables)[number] }[] = [];
        const fresh: (typeof tables)[number][] = [];
        for (const table of tables) {
          const row = stored.find((r) => r.kind === table.kind && r.version === table.version);
          if (!row) {
            fresh.push(table);
            continue;
          }
          const change = storedVersionChange(row, table);
          if (change === 'CHANGED') throw new Refused('RULE_TABLE_CHANGED', { kind: table.kind, version: table.version });
          if (change === 'CLOSING' && table.validTo !== null) closing.push({ id: row.id, previousSha256: row.contentSha256, validTo: table.validTo, table });
        }
        // Closings first: the newer version may then start where the closed one ends.
        for (const { id, previousSha256, validTo, table } of closing) {
          await tx.ruleSet.update({
            where: { id },
            data: { validTo, contentSha256: table.contentSha256, content: asJson(table.content) },
          });
          await appendEvent(tx, {
            action: 'rules.closed',
            details: { kind: table.kind, version: table.version, validTo, previousSha256, contentSha256: table.contentSha256 },
          });
        }
        for (const table of fresh) {
          await tx.ruleSet.create({
            data: {
              kind: table.kind,
              version: table.version,
              validFrom: table.validFrom,
              validTo: table.validTo,
              contentSha256: table.contentSha256,
              content: asJson(table.content),
              loadedAt: at,
            },
          });
          await appendEvent(tx, {
            action: 'rules.loaded',
            details: { kind: table.kind satisfies RuleKind, version: table.version, contentSha256: table.contentSha256 },
          });
        }
        return { loaded: fresh.length, closed: closing.length };
      },
      { timeout: 60_000 },
    );
  } finally {
    await owner.$disconnect();
  }
}

const env = z.object({ MIGRATION_DATABASE_URL: z.string().min(1) }).safeParse(process.env);
if (!env.success) {
  refuse(new Refused('NO_OWNER_CONNECTION'));
} else {
  try {
    const result = await load(env.data.MIGRATION_DATABASE_URL);
    console.log(JSON.stringify({ level: 'info', msg: 'rule tables ready', ...result }));
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    refuse(error);
  } finally {
    await closeDb();
  }
}
