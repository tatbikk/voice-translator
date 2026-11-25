import { z } from 'zod';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, notFound, ok } from '@/server/http/responses';
import { SECURITY_POLICY } from '@mahkama/core';
import { createDraft } from '@/server/filings/service';
import { callerOf } from '@/server/filings/http';

// «إيداع ورقي»: the registry clerk records an application deposited on paper
// at the office, with its scan (decision 59).
export const POST = defineEndpoint({
  id: 'filings.create-paper',
  method: 'POST',
  path: '/api/v1/filings/paper',
  access: { kind: 'action', action: 'filing.paper' },
  resource: () => Promise.resolve({ kind: 'new-filing' as const }),
  rateLimit: (_client, session) => ({ key: `filing-writes:session:${session?.session.id ?? 'none'}`, rule: SECURITY_POLICY.filing.writesPerSession }),
  body: z.strictObject({}),
  handler: async ({ session }) => {
    const caller = callerOf(session);
    if (!caller) return notFound();
    const created = await createDraft(caller.subject, 'PAPER', caller.session.actor);
    return created.ok ? ok({ draftId: created.value }) : fail(created.status, created.code);
  },
});
