import { defineConfig } from 'prisma/config';

// Prisma 7 does not read .env files. Load the local one when present; real
// environment variables keep precedence. Never use Prisma's env() helper here:
// it throws when the variable is absent, which breaks the secret-less build.
// Locally the owner's connection lives in .env.owner, apart from the runtime
// configuration in .env: the web process never sees it (review A-01).
for (const file of ['.env.owner', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // no local file (CI, Docker image): rely on the environment
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Migrations run with the owner role only.
    url: process.env.MIGRATION_DATABASE_URL ?? '',
  },
});
