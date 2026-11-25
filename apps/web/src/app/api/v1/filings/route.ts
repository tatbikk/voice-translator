import { z } from 'zod';
import { defineEndpoint } from '@/server/http/endpoint';
import { notFound, ok } from '@/server/http/responses';
import { createDraft } from '@/server/filings/service';
import { callerOf } from '@/server/filings/http';

// «دعوى جديدة»: a draft of the lawyer's own, for the electronic filing (art. 76).
export const POST = defineEndpoint({
  id: 'filings.create',
  method: 'POST',
  path: '/api/v1/filings',
  access: { kind: 'action', action: 'filing.new' },
  resource: () => Promise.resolve({ kind: 'new-filing' as const }),
  body: z.strictObject({}),
  handler: async ({ session }) => {
    const caller = callerOf(session);
    if (!caller) return notFound();
    return ok({ draftId: await createDraft(caller.subject, 'ELECTRONIC', caller.session.actor) });
  },
});
