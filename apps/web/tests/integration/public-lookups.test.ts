// Memo row 23: using «تتبع الملف» or «جدول الجلسات» to inventory case files.
// Contract §4.5 and §6: case lookup 10 / 5 min per client (global 300 / 5 min,
// see public-lookups-global.test.ts); hearings 30 / 5 min per client, dates
// within today −7 … +60 days; answers carry only { status, nextHearingAt } and
// [{ startsAt, room, chamberLabelKey, caseNumbers }] — no party name, no document.
import { beforeAll, describe, expect, it } from 'vitest';
import { moroccoCalendarDate } from '@mahkama/core';
import { visitor } from '../helpers/auth';
import { createCaseFile, createHearing, theCourt, type CaseFileFixture, type CourtFixture } from '../helpers/factories';
import { describeResponse, type ApiResponse, type Client } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';

const DAY = 24 * 3600_000;

let court!: CourtFixture;
let scheduled!: CaseFileFixture;
let unscheduled!: CaseFileFixture;
let hearingAt!: Date;

function lookup(client: Client, caseFile: Pick<CaseFileFixture, 'number' | 'code' | 'year'>, courtId = court.id): Promise<ApiResponse> {
  return client.get('/api/v1/public/case-status', {
    query: { courtId, number: caseFile.number, code: caseFile.code, year: caseFile.year },
  });
}

function hearings(client: Client, date: string): Promise<ApiResponse> {
  return client.get('/api/v1/public/hearings', { query: { courtId: court.id, date } });
}

function expectTooMany(res: ApiResponse): void {
  expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 429, code: 'TOO_MANY_REQUESTS' });
  expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
}

describe('public lookups (memo row 23)', () => {
  useFreshDatabase();

  beforeAll(async () => {
    court = await theCourt();
    hearingAt = new Date(Date.now() + 3 * DAY);
    hearingAt.setUTCHours(9, 30, 0, 0);
    const hearingId = await createHearing(court.id, hearingAt, 'القاعة 5');
    scheduled = await createCaseFile({ courtId: court.id, hearingId, status: 'IN_PREPARATION', number: 1234, code: 8201, year: 2026 });
    unscheduled = await createCaseFile({ courtId: court.id, status: 'JUDGMENT_ISSUED', number: 77, code: 8201, year: 2025 });
  });

  describe('«تتبع الملف»', () => {
    it('row 23: the answer holds the status and the next hearing, nothing else', async () => {
      const res = await lookup(await visitor(), scheduled);
      expect(res.status, describeResponse(res)).toBe(200);
      const data = res.data as Record<string, unknown>;
      expect(Object.keys(data).sort()).toEqual(['nextHearingAt', 'status']);
      expect(data.status).toBe('IN_PREPARATION');
      expect(new Date(String(data.nextHearingAt)).getTime()).toBe(hearingAt.getTime());
      expect(res.text).not.toContain(scheduled.id);
    });

    it('row 23: a case without a next hearing answers a null date', async () => {
      const res = await lookup(await visitor(), unscheduled);
      expect(res.status, describeResponse(res)).toBe(200);
      expect(res.data).toEqual({ status: 'JUDGMENT_ISSUED', nextHearingAt: null });
    });

    it('row 23: an unknown case answers CASE_NOT_FOUND', async () => {
      const res = await lookup(await visitor(), { number: 999_999, code: 9999, year: 2030 });
      expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 404, code: 'CASE_NOT_FOUND' });
    });

    it('row 23: ten lookups per client in five minutes, then 429', async () => {
      const client = await visitor();
      for (let i = 0; i < 10; i += 1) {
        const res = await lookup(client, i % 2 === 0 ? scheduled : { number: 5000 + i, code: 8201, year: 2026 });
        expect(res.status, `lookup ${String(i + 1)}: ${describeResponse(res)}`).not.toBe(429);
      }
      expectTooMany(await lookup(client, scheduled));
      expect((await lookup(await visitor(), scheduled)).status, 'another client is not affected').toBe(200);
    });

    it('a malformed query is refused', async () => {
      const client = await visitor();
      const res = await client.get('/api/v1/public/case-status', { query: { courtId: 'x', number: 'abc', code: '1', year: '26' } });
      expect(res.status, describeResponse(res)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('«جدول الجلسات»', () => {
    it('row 23: each hearing gives its time, room, chamber and case numbers, nothing else', async () => {
      const res = await hearings(await visitor(), moroccoCalendarDate(hearingAt));
      expect(res.status, describeResponse(res)).toBe(200);
      const list = res.data as Record<string, unknown>[];
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBe(1);
      const hearing = list[0] ?? {};
      expect(Object.keys(hearing).sort()).toEqual(['caseNumbers', 'chamberLabelKey', 'room', 'startsAt']);
      expect(new Date(String(hearing.startsAt)).getTime()).toBe(hearingAt.getTime());
      expect(hearing.room).toBe('القاعة 5');
      expect(hearing.caseNumbers).toEqual(['1234/8201/2026']);
    });

    it('row 23: a day without hearings answers an empty list', async () => {
      const res = await hearings(await visitor(), moroccoCalendarDate(new Date(hearingAt.getTime() + DAY)));
      expect(res.status, describeResponse(res)).toBe(200);
      expect(res.data).toEqual([]);
    });

    it('row 23: dates outside today −7 … +60 days are refused', async () => {
      const client = await visitor();
      for (const offset of [-8, 61]) {
        const res = await hearings(client, moroccoCalendarDate(new Date(Date.now() + offset * DAY)));
        expect(res.envelope?.ok, `${String(offset)} days: ${describeResponse(res)}`).toBe(false);
        expect([400, 404, 422]).toContain(res.status);
      }
      for (const offset of [-7, 60]) {
        const res = await hearings(client, moroccoCalendarDate(new Date(Date.now() + offset * DAY)));
        expect(res.status, `${String(offset)} days: ${describeResponse(res)}`).toBe(200);
      }
    });

    it('row 23: thirty lists per client in five minutes, then 429', async () => {
      const client = await visitor();
      const date = moroccoCalendarDate(hearingAt);
      for (let i = 0; i < 30; i += 1) {
        const res = await hearings(client, date);
        expect(res.status, `list ${String(i + 1)}: ${describeResponse(res)}`).toBe(200);
      }
      expectTooMany(await hearings(client, date));
    });
  });
});
