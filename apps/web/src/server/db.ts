import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { getEnv } from './config/env';

// One Prisma client per process, created on first use (never at module load),
// connected as the runtime role. Statement and lock timeouts bound every query,
// including the advisory lock of the event log.

const holder = globalThis as unknown as { __mahkamaDb?: PrismaClient };

export type Db = PrismaClient;

export function getDb(): PrismaClient {
  if (holder.__mahkamaDb) return holder.__mahkamaDb;
  const adapter = new PrismaPg({
    connectionString: getEnv().databaseUrl,
    max: 10,
    options: '-c statement_timeout=15000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=30000',
  });
  holder.__mahkamaDb = new PrismaClient({ adapter });
  return holder.__mahkamaDb;
}

export async function closeDb(): Promise<void> {
  const db = holder.__mahkamaDb;
  delete holder.__mahkamaDb;
  if (db) await db.$disconnect();
}
