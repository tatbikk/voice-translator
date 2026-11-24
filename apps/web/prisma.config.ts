import { defineConfig } from 'prisma/config';

// Prisma 7 does not read .env files. Load the local one when present; real
// environment variables keep precedence. Never use Prisma's env() helper here:
// it throws when the variable is absent, which breaks the secret-less build.
try {
  process.loadEnvFile('.env');
} catch {
  // no local .env (CI, Docker image): rely on the environment
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
