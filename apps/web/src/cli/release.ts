// Release step, run once at every deployment by the release service (built from
// the same image), which then exits: the web service and the worker refuse to
// boot until it has applied this version's migrations.
// Production: the migration guard (decision 83), migrations, then the runtime-role grants (which stamp an empty
// database "production"). Demo: the demo-data command, which applies the same
// migrations and grants itself, stamps the database "demo" and creates what is
// missing; it refuses any database stamped "production". Never a reset.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enforceBuild } from '@/server/boot/build-info';
import { migrationsMayDeploy } from './migration-guard';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(args: string[]): void {
  const result = spawnSync(process.execPath, args, { cwd: webRoot, stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    console.error(JSON.stringify({ level: 'error', msg: 'release step failed', step: args[0] ?? '' }));
    process.exit(1);
  }
}

// The build marker first, like every process (review A-15): a demo image never
// migrates a production database.
enforceBuild('release');

const prismaCli = join(dirname(createRequire(import.meta.url).resolve('prisma/package.json')), 'build', 'index.js');

function refuse(code: string): never {
  console.error(JSON.stringify({ level: 'error', msg: 'release refused', code }));
  process.exit(1);
}

switch (process.env.APP_MODE) {
  case 'production': {
    // Nothing is migrated when a pending migration is dated before one already applied
    // (decision 83): the guard reads "_prisma_migrations" and logs which.
    const owner = process.env.MIGRATION_DATABASE_URL;
    if (!owner) refuse('INVALID_ENV');
    if (!(await migrationsMayDeploy(owner, join(webRoot, 'prisma', 'migrations'), 'release'))) refuse('MIGRATION_DATED_BEFORE_APPLIED');
    run([prismaCli, 'migrate', 'deploy']);
    run([join(webRoot, 'dist-server', 'db-roles.mjs')]);
    run([join(webRoot, 'dist-server', 'load-rules.mjs')]);
    break;
  }
  case 'demo':
    run([join(webRoot, 'dist-server', 'seed.mjs')]);
    break;
  default:
    refuse('INVALID_APP_MODE');
}
console.log(JSON.stringify({ level: 'info', msg: 'release done', mode: process.env.APP_MODE }));
