// Memo rows 6 and 7, contract §4.5: the global passphrase cap. Whatever the
// client address, 50 failures within 15 minutes refuse new attempts, even with
// the right passphrase; visitors already holding a valid access cookie are not
// affected. Its own file: the cap would otherwise block the rest of a suite.
import { randomBytes } from 'node:crypto';
import { moroccoCalendarDate } from '@mahkama/core';
import { describe, expect, it } from 'vitest';
import { passGate, visitor } from '../helpers/auth';
import { eventsAfter, headSeq } from '../helpers/db';
import { theCourt } from '../helpers/factories';
import { COOKIE, Client, describeResponse, nextIp } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';

const wrongPassphrase = () => `not-the-passphrase-${randomBytes(6).toString('hex')}`;

describe('global passphrase cap (memo rows 6 and 7)', () => {
  useFreshDatabase();

  it('rows 6 and 7: fifty failures from rotating addresses refuse every new attempt; cookie holders are unaffected', async () => {
    const court = await theCourt();
    const holder = await visitor();
    const since = await headSeq();

    for (let i = 0; i < 49; i += 1) {
      const res = await new Client({ ip: nextIp() }).post(
        '/api/v1/access',
        { code: wrongPassphrase() },
        { headers: { 'X-Forwarded-For': `198.51.100.${String(i + 1)}` } },
      );
      expect(res.envelope?.ok, `failure ${String(i + 1)}: ${describeResponse(res)}`).toBe(false);
      expect(res.status, `failure ${String(i + 1)} must not be blocked yet`).not.toBe(429);
    }
    const stillOpen = new Client({ ip: nextIp() });
    expect((await passGate(stillOpen)).status, 'after 49 failures the gate still opens').toBe(200);

    await passGate(new Client({ ip: nextIp() }), wrongPassphrase()); // the fiftieth failure

    const late = new Client({ ip: nextIp() });
    const refused = await passGate(late);
    expect({ status: refused.status, code: refused.code }, describeResponse(refused)).toEqual({
      status: 429,
      code: 'TOO_MANY_REQUESTS',
    });
    expect(late.cookie(COOKIE.access)).toBeUndefined();
    expect((await eventsAfter(since, 'access.code.blocked')).some((e) => e.details.scope === 'global')).toBe(true);

    // Holders of a valid access cookie keep using the platform.
    for (const client of [holder, stillOpen]) {
      const res = await client.get('/api/v1/public/hearings', { query: { courtId: court.id, date: moroccoCalendarDate(new Date()) } });
      expect(res.code, describeResponse(res)).not.toBe('ACCESS_CODE_REQUIRED');
      expect(res.status, describeResponse(res)).toBeLessThan(400);
    }
  });
});
