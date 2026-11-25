// Direct database access for the tests: the OWNER connection (fixtures, moving
// timestamps, deliberate tampering) and the RUNTIME-role connection (permission
// tests). The application itself is only ever reached through its route
// handlers.
import pg from 'pg';
import { requireEnv } from './env';

let ownerPool: pg.Pool | null = null;
let runtimePool: pg.Pool | null = null;

/** Pool on MIGRATION_DATABASE_URL: the owner role. */
export function owner(): pg.Pool {
  ownerPool ??= new pg.Pool({ connectionString: requireEnv('MIGRATION_DATABASE_URL'), max: 4 });
  return ownerPool;
}

/** Pool on DATABASE_URL: the runtime role mahkama_app. */
export function runtime(): pg.Pool {
  runtimePool ??= new pg.Pool({ connectionString: requireEnv('DATABASE_URL'), max: 2 });
  return runtimePool;
}

export async function closePools(): Promise<void> {
  const pools = [ownerPool, runtimePool].filter((p): p is pg.Pool => p !== null);
  ownerPool = null;
  runtimePool = null;
  await Promise.all(pools.map((p) => p.end()));
}

/** A dedicated client on the runtime role, for statements that must not share a pooled session. */
export async function runtimeClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: requireEnv('DATABASE_URL') });
  await client.connect();
  return client;
}

export async function ownerClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: requireEnv('MIGRATION_DATABASE_URL') });
  await client.connect();
  return client;
}

export async function sql<T = Record<string, unknown>>(text: string, params: readonly unknown[] = []): Promise<T[]> {
  const result = await owner().query(text, [...params]);
  return result.rows as T[];
}

export async function one<T = Record<string, unknown>>(text: string, params: readonly unknown[] = []): Promise<T> {
  const rows = await sql<T>(text, params);
  if (rows.length !== 1) throw new Error(`expected exactly one row, got ${String(rows.length)}: ${text}`);
  return rows[0]!;
}

/** The first column of the first row, as a number: `SELECT count(*) …` with or without `AS n`. */
export async function count(text: string, params: readonly unknown[] = []): Promise<number> {
  const rows = await sql<Record<string, unknown>>(text, params);
  const row = rows[0];
  const value = row ? (row.n ?? Object.values(row)[0]) : 0;
  return Number(value ?? 0);
}

// ---------------------------------------------------------------------------
// Event log

export type EventRow = {
  readonly seq: number;
  readonly id: string;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly actorUserId: string | null;
  readonly actorRoleAssignmentId: string | null;
  readonly actorRole: string | null;
  readonly viaDemoSwitch: boolean;
  readonly clientIdHash: string | null;
  readonly action: string;
  readonly outcome: string;
  readonly caseFileId: string | null;
  readonly legalBasis: unknown;
  readonly details: Record<string, unknown>;
  readonly keyVersion: number;
  readonly prevHash: string;
  readonly hash: string;
};

type RawEventRow = Omit<EventRow, 'seq'> & { seq: string };

function toEvent(row: RawEventRow): EventRow {
  return { ...row, seq: Number(row.seq) };
}

/** The whole event log in order, or only the entries of one action. */
export async function events(action?: string): Promise<EventRow[]> {
  const rows = action
    ? await sql<RawEventRow>('SELECT * FROM "Event" WHERE action = $1 ORDER BY seq', [action])
    : await sql<RawEventRow>('SELECT * FROM "Event" ORDER BY seq');
  return rows.map(toEvent);
}

/** The sequence number of the last event (0 when the log is empty). */
export async function headSeq(): Promise<number> {
  const rows = await sql<{ seq: string | null }>('SELECT max(seq)::text AS seq FROM "Event"');
  return Number(rows[0]?.seq ?? 0);
}

export async function eventsAfter(seq: number, action?: string): Promise<EventRow[]> {
  const rows = action
    ? await sql<RawEventRow>('SELECT * FROM "Event" WHERE seq > $1 AND action = $2 ORDER BY seq', [seq, action])
    : await sql<RawEventRow>('SELECT * FROM "Event" WHERE seq > $1 ORDER BY seq', [seq]);
  return rows.map(toEvent);
}

/** Runs `fn` and returns the events it appended. */
export async function capturingEvents<T>(fn: () => Promise<T>): Promise<{ result: T; events: EventRow[] }> {
  const before = await headSeq();
  const result = await fn();
  return { result, events: await eventsAfter(before) };
}

// ---------------------------------------------------------------------------
// Sessions, challenges, locks and outbound messages

export type SessionRow = {
  readonly id: string;
  readonly userId: string;
  readonly state: 'PENDING_SECOND_FACTOR' | 'PENDING_ROLE' | 'ACTIVE';
  readonly origin: 'LOGIN' | 'DEMO_SWITCH';
  readonly roleAssignmentId: string | null;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly pendingExpiresAt: Date | null;
  readonly previousLoginAt: Date | null;
  readonly reauthAt: Date | null;
  readonly revokedAt: Date | null;
  readonly revokeReason: string | null;
};

export async function sessionsOf(userId: string): Promise<SessionRow[]> {
  return sql<SessionRow>('SELECT * FROM "Session" WHERE "userId" = $1 ORDER BY "createdAt", id', [userId]);
}

/** The newest session of the user that has not been revoked, if any. */
export async function liveSession(userId: string): Promise<SessionRow | null> {
  const rows = await sql<SessionRow>(
    'SELECT * FROM "Session" WHERE "userId" = $1 AND "revokedAt" IS NULL ORDER BY "createdAt" DESC, "lastSeenAt" DESC LIMIT 1',
    [userId],
  );
  return rows[0] ?? null;
}

export async function liveSessions(userId: string): Promise<SessionRow[]> {
  return sql<SessionRow>('SELECT * FROM "Session" WHERE "userId" = $1 AND "revokedAt" IS NULL', [userId]);
}

export type ChallengeRow = {
  readonly id: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly voidedAt: Date | null;
};

export async function challengesOf(userId: string): Promise<ChallengeRow[]> {
  return sql<ChallengeRow>('SELECT * FROM "SecondFactorChallenge" WHERE "userId" = $1 ORDER BY "createdAt", id', [userId]);
}

export type LockoutRow = {
  readonly id: string;
  readonly identifierHash: string;
  readonly bucket: string;
  readonly cause: string;
  readonly createdAt: Date;
  readonly until: Date;
};

export async function allLockouts(): Promise<LockoutRow[]> {
  return sql<LockoutRow>('SELECT * FROM "Lockout" ORDER BY "createdAt", id');
}

export async function activeLockouts(): Promise<LockoutRow[]> {
  return sql<LockoutRow>('SELECT * FROM "Lockout" WHERE "until" > now() ORDER BY "createdAt", id');
}

/** Moves every lock that is still in force into the past (the lock delay "has elapsed"). */
export async function expireLockouts(): Promise<void> {
  await sql(`UPDATE "Lockout" SET "until" = now() - interval '1 second' WHERE "until" > now()`);
}

export type OutboundRow = {
  readonly id: string;
  readonly channel: 'SMS' | 'EMAIL';
  readonly recipientUserId: string | null;
  readonly recipientAddress: string;
  readonly templateKey: string;
  readonly body: string;
  readonly holdsSecret: boolean;
  readonly visibleToSessionId: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
};

export async function outboundTo(userId: string, channel?: 'SMS' | 'EMAIL'): Promise<OutboundRow[]> {
  return channel
    ? sql<OutboundRow>(
        'SELECT * FROM "OutboundMessage" WHERE "recipientUserId" = $1 AND channel = $2 ORDER BY "createdAt", id',
        [userId, channel],
      )
    : sql<OutboundRow>('SELECT * FROM "OutboundMessage" WHERE "recipientUserId" = $1 ORDER BY "createdAt", id', [userId]);
}

export async function outboundCount(): Promise<number> {
  return count('SELECT count(*)::text AS n FROM "OutboundMessage"');
}

export async function notificationsOf(userId: string): Promise<{ id: string; kind: string; readAt: Date | null }[]> {
  return sql<{ id: string; kind: string; readAt: Date | null }>('SELECT id, kind, "readAt" FROM "Notification" WHERE "userId" = $1 ORDER BY "createdAt", id', [userId]);
}

export async function authAttemptCount(kind?: string): Promise<number> {
  return kind
    ? count('SELECT count(*)::text AS n FROM "AuthAttempt" WHERE kind = $1', [kind])
    : count('SELECT count(*)::text AS n FROM "AuthAttempt"');
}
