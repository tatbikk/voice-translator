// Railway infrastructure of «منصة المحكمة الرقمية» (contract §12), for the demo
// environment. Railway never reads this file during a deploy: it is applied by
// `railway config plan` / `railway config apply` (or the railway-config workflow).
// See .railway/README.md for the first deployment.
//
// Secrets are never generated here (ctx.randomString() is predictable): the owner
// sets them once on the web service, `preserve()` keeps them, and the worker and
// the release step reference the web service's values, so that all hold the same keys.
//
// The owner's database connection and the demo password belong to the release
// service alone, which runs once per deployment and exits: no running process
// can rewrite the event log (review A-01). The web service and the worker refuse
// to boot until the release step has applied this version's migrations
// (SCHEMA_NOT_MIGRATED), and restart until it has.
import { bucket, defineRailway, github, postgres, preserve, project, ref, service } from 'railway/iac';

export default defineRailway(() => {
  const db = postgres('postgres');
  const documents = bucket('documents', { region: 'ams' });
  const source = github('tatbikk/voice-translator', { branch: 'main', checkSuites: true });
  const build = { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' } as const;

  // The runtime role owns nothing and may only read and append the event log.
  // The exact reference templating is confirmed by the first `railway config plan`.
  const runtimeDatabaseUrl =
    'postgresql://mahkama_app:${{shared.APP_DB_PASSWORD}}@${{postgres.PGHOST}}:${{postgres.PGPORT}}/${{postgres.PGDATABASE}}';

  const web = service('web', {
    source,
    build,
    // Retries cover the minutes the release step takes to migrate.
    deploy: { restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 10, drainingSeconds: 30 },
    start: 'node ../../node_modules/next/dist/bin/next start',
    healthcheck: '/healthz',
    healthcheckTimeout: 300,
    env: {
      APP_MODE: 'demo',
      DEMO_TOOLS: 'true',
      DEMO_BUILD: 'true',
      AI_EXTERNAL_ALLOWED: 'false',
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      APP_URL: 'https://${{RAILWAY_PUBLIC_DOMAIN}}',
      DATABASE_URL: runtimeDatabaseUrl,
      SESSION_SECRET: preserve(),
      SECRETS_MASTER_KEY: preserve(),
      ACCESS_CODE: preserve(),
      S3_BUCKET: ref(documents, 'BUCKET'),
      S3_ENDPOINT: ref(documents, 'ENDPOINT'),
      S3_REGION: ref(documents, 'REGION'),
      S3_ACCESS_KEY_ID: ref(documents, 'ACCESS_KEY_ID'),
      S3_SECRET_ACCESS_KEY: ref(documents, 'SECRET_ACCESS_KEY'),
    },
  });

  const worker = service('worker', {
    source,
    build,
    start: 'node dist-server/worker.mjs',
    deploy: { restartPolicyType: 'ALWAYS', drainingSeconds: 30 },
    env: {
      APP_MODE: 'demo',
      DEMO_TOOLS: 'true',
      DEMO_BUILD: 'true',
      AI_EXTERNAL_ALLOWED: 'false',
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      APP_URL: 'https://${{web.RAILWAY_PUBLIC_DOMAIN}}',
      DATABASE_URL: runtimeDatabaseUrl,
      SESSION_SECRET: web.env.SESSION_SECRET,
      SECRETS_MASTER_KEY: web.env.SECRETS_MASTER_KEY,
      ACCESS_CODE: web.env.ACCESS_CODE,
    },
  });

  // Release step: migrations, runtime-role grants, then (demo only) the idempotent
  // demo data. It runs once per deployment and exits; never a reset.
  const release = service('release', {
    source,
    build,
    start: 'node dist-server/release.mjs',
    deploy: { restartPolicyType: 'NEVER' },
    env: {
      APP_MODE: 'demo',
      DEMO_TOOLS: 'true',
      DEMO_BUILD: 'true',
      AI_EXTERNAL_ALLOWED: 'false',
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      APP_URL: 'https://${{web.RAILWAY_PUBLIC_DOMAIN}}',
      MIGRATION_DATABASE_URL: db.env.DATABASE_URL,
      DATABASE_URL: runtimeDatabaseUrl,
      APP_DB_PASSWORD: '${{shared.APP_DB_PASSWORD}}',
      SESSION_SECRET: web.env.SESSION_SECRET,
      SECRETS_MASTER_KEY: web.env.SECRETS_MASTER_KEY,
      ACCESS_CODE: web.env.ACCESS_CODE,
      SEED_DEMO_PASSWORD: preserve(),
    },
  });

  // No TCP proxy and no public domain on the database.
  return project('mahkama', { resources: [db, documents, release, web, worker] });
});
