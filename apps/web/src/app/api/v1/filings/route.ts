import { z } from 'zod';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, notFound, ok } from '@/server/http/responses';
import { SECURITY_POLICY } from '@mahkama/core';
import { createDraft } from '@/server/filings/service';
import { callerOf } from '@/server/filings/http';

// «دعوى جديدة»: a draft of the lawyer's own, for the electronic filing (art. 76).
export const POST = defineEndpoint({
  id: 'filings.create',
  method: 'POST',
  path: '/api/v1/filings',
  access: { kind: 'action', action: 'filing.new' },
  resource: () => Promise.resolve({ kind: 'new-filing' as const }),
  rateLimit: (_client, session) => ({ key: `filing-writes:session:${session?.session.id ?? 'none'}`, rule: SECURITY_POLICY.filing.writesPerSession }),
  body: z.strictObject({}),
  handler: async ({ session }) => {
    const caller = callerOf(session);
    if (!caller) return notFound();
    const created = await createDraft(caller.subject, 'ELECTRONIC', caller.session.actor);
    return created.ok ? ok({ draftId: created.value }) : fail(created.status, created.code);
  },
});
