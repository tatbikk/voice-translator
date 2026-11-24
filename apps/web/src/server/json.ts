import type { Prisma } from '@/generated/prisma/client';

/** A plain-data value as a JSON column value (readonly interfaces included). */
export function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
