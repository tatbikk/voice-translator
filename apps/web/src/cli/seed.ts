// Demo data (contract §10). Runs only in demo mode, and only on a database
// stamped "demo" or completely empty (which it then stamps "demo"): it can
// never touch a production database. Idempotent without --reset.
//
//   node dist-server/seed.mjs                      create what is missing
//   node dist-server/seed.mjs --reset --confirm=<database name>
//                                                  drop and recreate the schema first
//
// The reset never uses `prisma migrate reset` (which an AI agent must not run):
// it drops the schema over pg, then applies the migrations and the grants.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { z } from 'zod';
import { SECURITY_POLICY, moroccoCalendarDate, roleLabelKey } from '@mahkama/core';
import { clock } from '@/server/clock';
import { closeDb, getDb } from '@/server/db';
import { appendStandaloneEvent } from '@/server/events/append';
import { hashPassword } from '@/server/auth/passwords';
import { enforceBuild } from '@/server/boot/build-info';
import { seedCaseContent } from './seed-cases';
import {
  DEMO_CASES,
  DEMO_COURTS,
  DEMO_ORGANIZATIONS,
  DEMO_PANELS,
  DEMO_USERS,
  demoEmail,
  demoPhone,
  type DemoCourtKey,
  type DemoOrganizationKey,
  type DemoPanelKey,
} from './seed-data/accounts';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const schema = z.object({
  APP_MODE: z.literal('demo'),
  MIGRATION_DATABASE_URL: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  SEED_DEMO_PASSWORD: z.string().min(SECURITY_POLICY.fields.passwordMin).max(SECURITY_POLICY.fields.passwordMax),
});

function fail(code: string): never {
  console.error(JSON.stringify({ level: 'error', msg: 'seed refused', code }));
  process.exit(1);
}

function run(args: string[]): void {
  const result = spawnSync(process.execPath, args, { cwd: webRoot, stdio: 'inherit', env: process.env });
  if (result.status !== 0) fail(`STEP_FAILED:${args[0] ?? ''}`);
}

function prismaCli(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('prisma/package.json')), 'build', 'index.js');
}

/** A wall-clock time in Morocco on a calendar day, as an instant (any offset, Ramadan included). */
function moroccoInstant(day: string, time: string): Date {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
  let guess = Date.UTC(y, mo - 1, d, h, m);
  for (let i = 0; i < 2; i += 1) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Casablanca',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const lh = Number(parts.find((p) => p.type === 'hour')?.value ?? h);
    const lm = Number(parts.find((p) => p.type === 'minute')?.value ?? m);
    guess -= (lh * 60 + lm - (h * 60 + m)) * 60_000;
  }
  return new Date(guess);
}

function addDays(day: string, days: number): string {
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  // The build marker first, like every process (review A-15).
  enforceBuild('seed');
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) fail(`INVALID_ENV:${parsed.error.issues.map((i) => i.path.join('.')).join(',')}`);
  const env = parsed.data;
  const reset = process.argv.includes('--reset');
  const confirm = process.argv.find((a) => a.startsWith('--confirm='))?.slice('--confirm='.length);

  const owner = new pg.Client({ connectionString: env.MIGRATION_DATABASE_URL });
  await owner.connect();
  let previousHead: { seq: number; hash: string } | null = null;
  try {
    const database = (await owner.query<{ d: string }>('SELECT current_database() AS d')).rows[0]?.d;
    if (!database) fail('NO_DATABASE_NAME');
    const tables = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'SystemState'`,
    );
    const migrated = tables.rows[0]?.n === '1';
    let stamp: string | null = null;
    let users = 0;
    let events = 0;
    if (migrated) {
      stamp = (await owner.query<{ m: string | null }>('SELECT "databaseMode" AS m FROM "SystemState" WHERE id = 1')).rows[0]?.m ?? null;
      users = Number((await owner.query<{ n: string }>('SELECT count(*)::text AS n FROM "User"')).rows[0]?.n ?? '0');
      events = Number((await owner.query<{ n: string }>('SELECT count(*)::text AS n FROM "Event"')).rows[0]?.n ?? '0');
    }
    // The property that matters is not the caller's mode but the database's own stamp.
    if (stamp === 'production') fail('DATABASE_STAMPED_PRODUCTION');
    if (stamp === null && (users > 0 || events > 0)) fail('DATABASE_NOT_EMPTY_AND_NOT_STAMPED');

    if (reset) {
      if (confirm !== database) fail('RESET_NEEDS_CONFIRM_WITH_DATABASE_NAME');
      if (migrated && events > 0) {
        const head = await owner.query<{ seq: string; hash: string }>('SELECT "seq"::text AS seq, "hash" FROM "Event" ORDER BY "Event"."seq" DESC LIMIT 1');
        if (head.rows[0]) previousHead = { seq: Number(head.rows[0].seq), hash: head.rows[0].hash };
        console.log(JSON.stringify({ level: 'info', msg: 'previous event chain head', ...previousHead }));
      }
      await owner.query('DROP SCHEMA public CASCADE');
      await owner.query('CREATE SCHEMA public');
    }
  } finally {
    await owner.end();
  }

  // Schema and grants (both idempotent).
  run([prismaCli(), 'migrate', 'deploy']);
  run([join(webRoot, 'dist-server', 'db-roles.mjs')]);

  const stamper = new pg.Client({ connectionString: env.MIGRATION_DATABASE_URL });
  await stamper.connect();
  try {
    await stamper.query(`UPDATE "SystemState" SET "databaseMode" = 'demo', "updatedAt" = now() WHERE id = 1 AND "databaseMode" IS NULL`);
    const stamp = (await stamper.query<{ m: string | null }>('SELECT "databaseMode" AS m FROM "SystemState" WHERE id = 1')).rows[0]?.m;
    if (stamp !== 'demo') fail('DATABASE_NOT_STAMPED_DEMO');
  } finally {
    await stamper.end();
  }

  await clock.refresh();
  // The reset is the first event of the new chain, before the rule tables are loaded.
  if (previousHead) {
    await appendStandaloneEvent({
      action: 'demo.data.reset',
      details: { previousHeadSeq: previousHead.seq, previousHeadHash: previousHead.hash },
    });
  }
  run([join(webRoot, 'dist-server', 'load-rules.mjs')]);
  const db = getDb();
  const now = clock.now();

  const courtIds = {} as Record<DemoCourtKey, string>;
  for (const [key, court] of Object.entries(DEMO_COURTS) as [DemoCourtKey, (typeof DEMO_COURTS)[DemoCourtKey]][]) {
    const row = await db.court.upsert({
      where: { code: court.code },
      create: { code: court.code, name: court.name, degree: court.degree, createdAt: now },
      update: {},
    });
    courtIds[key] = row.id;
  }
  await db.court.update({ where: { id: courtIds.firstInstance }, data: { appealCourtId: courtIds.appeal } });

  const panelIds = {} as Record<DemoPanelKey, string>;
  for (const [key, panel] of Object.entries(DEMO_PANELS) as [DemoPanelKey, (typeof DEMO_PANELS)[DemoPanelKey]][]) {
    const courtId = courtIds[panel.court];
    const existing = await db.panel.findFirst({ where: { courtId, name: panel.name } });
    panelIds[key] = (existing ?? (await db.panel.create({ data: { courtId, name: panel.name, kind: panel.kind, createdAt: now } }))).id;
  }

  const organizationIds = {} as Record<DemoOrganizationKey, string>;
  for (const [key, org] of Object.entries(DEMO_ORGANIZATIONS) as [DemoOrganizationKey, (typeof DEMO_ORGANIZATIONS)[DemoOrganizationKey]][]) {
    const existing = await db.organization.findFirst({ where: { name: org.name, kind: org.kind } });
    organizationIds[key] = (existing ?? (await db.organization.create({ data: { kind: org.kind, name: org.name, isDemo: true, createdAt: now } }))).id;
  }

  const passwordHash = await hashPassword(env.SEED_DEMO_PASSWORD);
  let createdUsers = 0;
  for (const [index, demo] of DEMO_USERS.entries()) {
    const email = demoEmail(demo.key);
    let user = await db.user.findUnique({ where: { email } });
    if (!user) {
      user = await db.user.create({
        data: { email, fullName: demo.fullName, phone: demoPhone(index), passwordHash, isDemo: true, createdAt: now },
      });
      createdUsers += 1;
    }
    for (const r of demo.roles) {
      const courtId = r.court ? courtIds[r.court] : null;
      const panelId = r.panel ? panelIds[r.panel] : null;
      const organizationId = r.organization ? organizationIds[r.organization] : null;
      const existing = await db.roleAssignment.findFirst({ where: { userId: user.id, role: r.role, courtId, panelId } });
      if (existing) continue;
      await db.roleAssignment.create({
        data: {
          userId: user.id,
          role: r.role,
          courtId,
          panelId,
          organizationId,
          verificationStatus: 'VERIFIED_SIMULATED',
          verificationSource: 'demo-seed',
          createdAt: now,
        },
      });
      await db.notification.create({
        data: {
          userId: user.id,
          kind: 'INFORMATION',
          templateKey: 'notifications.accountCreated',
          params: { roleKey: roleLabelKey(r.role, r.court ? DEMO_COURTS[r.court].degree : null) },
          createdAt: now,
        },
      });
    }
  }

  const today = moroccoCalendarDate(now);
  let caseFiles = 0;
  for (const demo of DEMO_CASES) {
    const courtId = courtIds[demo.court];
    const existing = await db.caseFile.findUnique({
      where: { courtId_number_code_year: { courtId, number: demo.number, code: demo.code, year: demo.year } },
    });
    if (existing) continue;
    let nextHearingId: string | null = null;
    if (demo.hearingInDays !== null) {
      const hearing = await db.hearing.create({
        data: {
          courtId,
          panelId: panelIds[demo.panel],
          room: demo.room,
          startsAt: moroccoInstant(addDays(today, demo.hearingInDays), demo.hearingTime),
          isDemo: true,
        },
      });
      nextHearingId = hearing.id;
    }
    await db.caseFile.create({
      data: {
        nationalRef: `DEMO-${String(demo.year)}-${String(demo.code)}-${String(demo.number).padStart(6, '0')}-${demo.court === 'appeal' ? 'AP' : 'FI'}`,
        courtId,
        number: demo.number,
        code: demo.code,
        year: demo.year,
        status: demo.status,
        nextHearingId,
        isDemo: true,
        createdAt: now,
      },
    });
    caseFiles += 1;
  }

  const filledCases = await seedCaseContent({ courtIds, panelIds, signingSecret: env.SEED_DEMO_PASSWORD });

  if (createdUsers > 0 || caseFiles > 0) {
    await appendStandaloneEvent({ action: 'demo.data.seeded', details: { users: createdUsers, caseFiles } });
  }
  console.log(JSON.stringify({ level: 'info', msg: 'demo data ready', createdUsers, caseFiles, filledCases }));
  await closeDb();
}

await main();
