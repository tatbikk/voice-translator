import { z } from 'zod';
import { SECURITY_POLICY } from '@mahkama/core';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, ok } from '@/server/http/responses';
import { draftResource } from '@/server/filings/drafts';
import { withDraft } from '@/server/filings/http';
import { submitDraft } from '@/server/filings/registration';

// «توقيع وإيداع»: the lawyer signs the fixed copy with the signing secret, and
// the file is registered in the same transaction (decision 58). A paper filing
// carries no electronic signature (decision 59).
export const POST = defineEndpoint({
  id: 'filings.submit',
  method: 'POST',
  path: '/api/v1/filings/:draftId/submit',
  access: { kind: 'action', action: 'filing.draft.submit' },
  params: z.strictObject({ draftId: z.uuid() }),
  resource: (p) => draftResource(p.draftId),
  rateLimit: (_client, session) => ({ key: `filing-writes:session:${session?.session.id ?? 'none'}`, rule: SECURITY_POLICY.filing.writesPerSession }),
  body: z.strictObject({ secret: z.string().min(1).max(SECURITY_POLICY.fields.passwordMax).optional() }),
  handler: ({ params: p, body, session }) =>
    withDraft(p.draftId, session, async (draft, caller) => {
      const filed = await submitDraft(draft.id, caller.subject, body.secret ?? null, caller.session.actor);
      if (!filed.ok) return fail(filed.status, filed.code);
      return ok({ caseFileId: filed.caseFileId, number: filed.number, code: filed.code, year: filed.year, nationalRef: filed.nationalRef });
    }),
});
