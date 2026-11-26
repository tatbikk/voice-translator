import { z } from 'zod';
import { SECURITY_POLICY } from '@mahkama/core';
import { appendStandaloneEvent } from '@/server/events/append';
import { defineEndpoint } from '@/server/http/endpoint';
import { ok } from '@/server/http/responses';
import { commercialRegister } from '@/server/registers/commercial';

// The commercial register, looked up by full trade register number only (memo
// row 22): the card is filled from the answer, which always carries its source,
// «مصدر محاكى» in the demo. The event records that a lookup was made, never
// the number. A GET with effects (it asks the register and spends the
// session's budget): it passes the CSRF step, and the page sends its token
// (decision 80).
export const GET = defineEndpoint({
  id: 'registers.commercial.lookup',
  method: 'GET',
  path: '/api/v1/registers/commercial',
  access: { kind: 'action', action: 'registers.commercial.lookup' },
  sideEffects: true,
  params: z.strictObject({ number: z.string().trim().min(3).max(40) }),
  rateLimit: (_client, session) => ({ key: `register:session:${session?.session.id ?? 'none'}`, rule: SECURITY_POLICY.registerLookup.perSession }),
  handler: async ({ params, session }) => {
    const register = commercialRegister();
    const entry = await register.lookup(params.number);
    await appendStandaloneEvent({ action: 'registers.commercial.looked-up', details: { found: entry !== null }, actor: session?.actor ?? null });
    return ok({ entry, source: { implementation: register.component.implementation, nameKey: register.component.nameKey } });
  },
});
