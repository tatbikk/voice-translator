// Memo row 23, contract §4.5: the global case-lookup cap. Whatever the client,
// 300 lookups in 5 minutes refuse the next one, so that rotating addresses
// does not allow an inventory of case files. Its own file: the cap would block
// every other lookup test.
import { describe, expect, it } from 'vitest';
import { passGate } from '../helpers/auth';
import { createCaseFile, theCourt } from '../helpers/factories';
import { Client, describeResponse, nextIp } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';

describe('global case-lookup cap (memo row 23)', () => {
  useFreshDatabase();

  it('row 23: after 300 lookups from rotating addresses within five minutes, a new client is refused', async () => {
    const court = await theCourt();
    const caseFile = await createCaseFile({ courtId: court.id });
    const query = { courtId: court.id, number: caseFile.number, code: caseFile.code, year: caseFile.year };
    // One gate pass, reused under ever-changing addresses: the cap must not depend on the address.
    const gate = new Client({ ip: nextIp() });
    expect((await passGate(gate)).status).toBe(200);
    for (let i = 0; i < 300; i += 1) {
      const res = await gate.get('/api/v1/public/case-status', { query, ip: nextIp() });
      expect(res.status, `lookup ${String(i + 1)}: ${describeResponse(res)}`).toBe(200);
    }
    const late = await gate.get('/api/v1/public/case-status', { query, ip: nextIp() });
    expect({ status: late.status, code: late.code }, describeResponse(late)).toEqual({ status: 429, code: 'TOO_MANY_REQUESTS' });
  }, 120_000);
});
