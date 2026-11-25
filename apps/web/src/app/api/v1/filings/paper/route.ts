import { z } from 'zod';
import { defineEndpoint } from '@/server/http/endpoint';
import { notFound, ok } from '@/server/http/responses';
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
  body: z.strictObject({}),
  handler: async ({ session }) => {
    const caller = callerOf(session);
    if (!caller) return notFound();
    return ok({ draftId: await createDraft(caller.subject, 'PAPER', caller.session.actor) });
  },
});
