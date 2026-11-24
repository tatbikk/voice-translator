import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  computeEventHash,
  eventOutcome,
  GENESIS_HASH,
  validateEventDetails,
  type EventAction,
  type EventDetails,
  type EventRecord,
  type LegalBasis,
} from '@mahkama/core';
import type { Prisma } from '@/generated/prisma/client';
import { clock } from '../clock';
import { getDb } from '../db';
import { CURRENT_CHAIN_KEY_VERSION, chainKey } from './keyring';

// Appending to the event log (contract §5).
//
// appendEvent() MUST be the last statement of its transaction (READ COMMITTED):
// it takes a transaction-level advisory lock that serialises every writer of
// the log, so nothing slow may run after it before COMMIT. If the DONE event
// cannot be written, the whole action rolls back.
//
// appendStandaloneEvent() opens its own transaction. It is used for DENIED and
// FAILED events, always after the business transaction has ended, so that a
// rollback can never erase the record of a refusal.

// Arbitrary constant identifying the event-log lock.
const EVENT_LOG_LOCK = 582_506_390;

export interface EventActor {
  readonly userId: string;
  readonly roleAssignmentId: string | null;
  readonly role: string | null;
  readonly viaDemoSwitch: boolean;
}

export interface AppendInput<A extends EventAction> {
  readonly action: A;
  readonly details: EventDetails<A>;
  readonly actor?: EventActor | null;
  readonly clientIdHash?: string | null;
  readonly caseFileId?: string | null;
  readonly legalBasis?: LegalBasis | null;
}

export interface AppendedEvent {
  readonly seq: number;
  readonly id: string;
  readonly hash: string;
}

type Tx = Prisma.TransactionClient;

export async function appendEvent<A extends EventAction>(tx: Tx, input: AppendInput<A>): Promise<AppendedEvent> {
  const details = validateEventDetails(input.action, input.details);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${EVENT_LOG_LOCK})`;
  const head = await tx.$queryRaw<{ seq: bigint; hash: string }[]>`
    SELECT "seq", "hash" FROM "Event" ORDER BY "seq" DESC LIMIT 1`;
  const recorded = await tx.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS "at"`;
  const prevHash = head[0]?.hash ?? GENESIS_HASH;
  const seq = head[0] ? Number(head[0].seq) + 1 : 1;
  const record: EventRecord = {
    seq,
    id: randomUUID(),
    occurredAt: clock.now().toISOString(),
    recordedAt: (recorded[0]?.at ?? new Date(0)).toISOString(),
    actorUserId: input.actor?.userId ?? null,
    actorRoleAssignmentId: input.actor?.roleAssignmentId ?? null,
    actorRole: input.actor?.role ?? null,
    viaDemoSwitch: input.actor?.viaDemoSwitch ?? false,
    clientIdHash: input.clientIdHash ?? null,
    action: input.action,
    outcome: eventOutcome(input.action),
    caseFileId: input.caseFileId ?? null,
    legalBasis: input.legalBasis ?? null,
    details: details,
    keyVersion: CURRENT_CHAIN_KEY_VERSION,
  };
  const hash = computeEventHash(chainKey(CURRENT_CHAIN_KEY_VERSION), prevHash, record);
  await tx.event.create({
    data: {
      seq: BigInt(record.seq),
      id: record.id,
      occurredAt: new Date(record.occurredAt),
      recordedAt: new Date(record.recordedAt),
      actorUserId: record.actorUserId,
      actorRoleAssignmentId: record.actorRoleAssignmentId,
      actorRole: record.actorRole,
      viaDemoSwitch: record.viaDemoSwitch,
      clientIdHash: record.clientIdHash,
      action: record.action,
      outcome: record.outcome,
      caseFileId: record.caseFileId,
      ...(record.legalBasis === null ? {} : { legalBasis: record.legalBasis }),
      details: record.details,
      keyVersion: record.keyVersion,
      prevHash,
      hash,
    },
  });
  return { seq: record.seq, id: record.id, hash };
}

export async function appendStandaloneEvent<A extends EventAction>(input: AppendInput<A>): Promise<AppendedEvent> {
  return getDb().$transaction((tx) => appendEvent(tx, input), { isolationLevel: 'ReadCommitted', timeout: 10_000 });
}
