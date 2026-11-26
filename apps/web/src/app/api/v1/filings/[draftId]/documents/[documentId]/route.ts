import { z } from 'zod';
import { SECURITY_POLICY } from '@mahkama/core';
import { defineEndpoint } from '@/server/http/endpoint';
import { draftResource } from '@/server/filings/drafts';
import { answer, withDraft } from '@/server/filings/http';
import { UpdateDocumentBody, updateDocument } from '@/server/filings/service';

// The description of a document of the draft (its title, its declared nature,
// its pages, where its paper original is kept), or its removal before filing.
export const POST = defineEndpoint({
  id: 'filings.documents.update',
  method: 'POST',
  path: '/api/v1/filings/:draftId/documents/:documentId',
  access: { kind: 'action', action: 'filing.draft.edit' },
  params: z.strictObject({ draftId: z.uuid(), documentId: z.uuid() }),
  resource: (p) => draftResource(p.draftId),
  rateLimit: (_client, session) => ({ key: `filing-writes:session:${session?.session.id ?? 'none'}`, rule: SECURITY_POLICY.filing.writesPerSession }),
  body: UpdateDocumentBody,
  handler: ({ params: p, body, session, clientIdHash }) =>
    withDraft(p.draftId, session, async (draft, caller) => {
      return answer(await updateDocument(draft, p.documentId, body, caller.session.actor, { clientIdHash, sessionId: caller.session.session.id }));
    }),
});
