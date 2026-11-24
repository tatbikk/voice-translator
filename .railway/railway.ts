// Railway infrastructure of «منصة المحكمة الرقمية» (contract §12), for the demo
// environment. Railway never reads this file during a deploy: it is applied by
// `railway config plan` / `railway config apply` (or the railway-config workflow).
// See .railway/README.md for the first deployment.
//
// Secrets are never generated here (ctx.randomString() is predictable). They are
// project shared variables (SESSION_SECRET, SECRETS_MASTER_KEY, ACCESS_CODE,
// APP_DB_PASSWORD), set once and referenced by every service, so that all hold the
// same keys; SEED_DEMO_PASSWORD lives on the release service alone.
//
// Names follow the live project: the web service is "voice-translator" (it existed
// before this file) and the database is "Postgres" (Railway's template).
//
// The owner's database connection and the demo password belong to the release
// service alone, which runs once per deployment and exits: no running process
// can rewrite the event log (review A-01). The web service and the worker refuse
// to boot until the release step has applied this version's migrations
// (SCHEMA_NOT_MIGRATED), and restart until it has.
import { bucket, defineRailway, github, postgres, preserve, project, ref, service } from 'railway/iac';

export default defineRailway(() => {
  const db = postgres('Postgres');
  const documents = bucket('documents', { region: 'ams' });
  const source = github('tatbikk/voice-translator', { branch: 'main', checkSuites: true });
  const build = { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' } as const;

  // The runtime role owns nothing and may only read and append the event log.
  // The exact reference templating is confirmed by the first `railway config plan`.
  const runtimeDatabaseUrl =
    'postgresql://mahkama_app:${{shared.APP_DB_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}';
  const appUrl = 'https://${{voice-translator.RAILWAY_PUBLIC_DOMAIN}}';
  const sharedSecrets = {
    SESSION_SECRET: '${{shared.SESSION_SECRET}}',
    SECRETS_MASTER_KEY: '${{shared.SECRETS_MASTER_KEY}}',
    ACCESS_CODE: '${{shared.ACCESS_CODE}}',
  };

  const web = service('voice-translator', {
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
      PORT: '3000',
      APP_URL: 'https://${{RAILWAY_PUBLIC_DOMAIN}}',
      DATABASE_URL: runtimeDatabaseUrl,
      ...sharedSecrets,
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
      APP_URL: appUrl,
      DATABASE_URL: runtimeDatabaseUrl,
      ...sharedSecrets,
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
      APP_URL: appUrl,
      MIGRATION_DATABASE_URL: db.env.DATABASE_URL,
      DATABASE_URL: runtimeDatabaseUrl,
      APP_DB_PASSWORD: '${{shared.APP_DB_PASSWORD}}',
      ...sharedSecrets,
      SEED_DEMO_PASSWORD: preserve(),
    },
  });

  // No TCP proxy and no public domain on the database.
  return project('mahkama', { resources: [db, documents, release, web, worker] });
});
