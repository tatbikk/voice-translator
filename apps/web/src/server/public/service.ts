import 'server-only';
import { SECURITY_POLICY, moroccoCalendarDate, type CaseNumber, formatCaseNumber } from '@mahkama/core';
import { clock } from '../clock';
import { getDb } from '../db';
import { consume } from '../security/rate-limit';

// The two public pages litigants and lawyers already know (prompt, «الأدوار
// والواجهات»): «تتبع الملف» answers with the procedural state and the next
// hearing only — no document, no party name — and «جدول الجلسات» with times,
// rooms, panels and case numbers. Both are limited per client and overall so
// that they cannot be used to inventory the files. The limits live here, in
// the service shared by the page and the API route.

export type CaseStatusCode =
  | 'FILED'
  | 'REGISTERED'
  | 'RAPPORTEUR_ASSIGNED'
  | 'IN_NOTIFICATION'
  | 'IN_PREPARATION'
  | 'IN_EXPERTISE'
  | 'READY'
  | 'IN_DELIBERATION'
  | 'JUDGMENT_ISSUED'
  | 'UNDER_APPEAL'
  | 'IN_ENFORCEMENT'
  | 'CLOSED';

export type LookupResult<T> = { kind: 'ok'; value: T } | { kind: 'not-found' } | { kind: 'throttled'; retryAfterSeconds: number };

export async function publicCourts(): Promise<{ id: string; name: string }[]> {
  return getDb().court.findMany({ orderBy: [{ degree: 'asc' }, { name: 'asc' }], select: { id: true, name: true } });
}

export async function caseStatus(
  clientIdHash: string,
  courtId: string,
  number: CaseNumber,
): Promise<LookupResult<{ status: CaseStatusCode; nextHearingAt: Date | null }>> {
  const perClient = await consume(`lookup:client:${clientIdHash}`, SECURITY_POLICY.caseLookup.perClient);
  if (perClient.limited) return { kind: 'throttled', retryAfterSeconds: perClient.retryAfterSeconds };
  const global = await consume('lookup:global', SECURITY_POLICY.caseLookup.global);
  if (global.limited) return { kind: 'throttled', retryAfterSeconds: global.retryAfterSeconds };

  const file = await getDb().caseFile.findUnique({
    where: { courtId_number_code_year: { courtId, number: number.number, code: number.code, year: number.year } },
    select: { status: true, nextHearing: { select: { startsAt: true } } },
  });
  if (!file) return { kind: 'not-found' };
  return { kind: 'ok', value: { status: file.status, nextHearingAt: file.nextHearing?.startsAt ?? null } };
}

export interface HearingRow {
  readonly startsAt: Date;
  readonly room: string;
  readonly panelName: string;
  readonly caseNumbers: readonly string[];
}

const DAY = 24 * 60 * 60 * 1000;

/** Hearings of one court on one calendar day (Morocco time), within a fixed window around today. */
export async function hearingsOn(clientIdHash: string, courtId: string, date: string): Promise<LookupResult<HearingRow[]>> {
  const limit = await consume(`hearings:client:${clientIdHash}`, SECURITY_POLICY.hearings.perClient);
  if (limit.limited) return { kind: 'throttled', retryAfterSeconds: limit.retryAfterSeconds };

  const today = moroccoCalendarDate(clock.now());
  const offsetDays = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY;
  if (!Number.isFinite(offsetDays) || offsetDays < -SECURITY_POLICY.hearings.daysBefore || offsetDays > SECURITY_POLICY.hearings.daysAfter) {
    return { kind: 'not-found' };
  }
  // A Moroccan calendar day, whatever the offset of the day: take a wide UTC
  // range and keep the rows whose Morocco date is the requested one.
  const from = new Date(Date.parse(`${date}T00:00:00Z`) - DAY / 2);
  const to = new Date(Date.parse(`${date}T00:00:00Z`) + DAY * 1.5);
  const rows = await getDb().hearing.findMany({
    where: { courtId, startsAt: { gte: from, lt: to } },
    orderBy: { startsAt: 'asc' },
    include: { panel: { select: { name: true } }, caseFiles: { select: { number: true, code: true, year: true } } },
  });
  return {
    kind: 'ok',
    value: rows
      .filter((h) => moroccoCalendarDate(h.startsAt) === date)
      .map((h) => ({
        startsAt: h.startsAt,
        room: h.room,
        panelName: h.panel.name,
        caseNumbers: h.caseFiles.map((c) => formatCaseNumber({ number: c.number, code: c.code, year: c.year })),
      })),
  };
}
