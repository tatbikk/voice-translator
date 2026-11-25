import { z } from 'zod';
import { SECURITY_POLICY } from '@mahkama/core';
import { defineEndpoint } from '@/server/http/endpoint';
import { draftResource } from '@/server/filings/drafts';
import { answer, withDraft } from '@/server/filings/http';
import { pasteApplication } from '@/server/filings/service';

// The application pasted as text: its paragraphs are numbered, and the worker
// prints the fixed copy that is signed and filed (decision 63).
export const POST = defineEndpoint({
  id: 'filings.application-text',
  method: 'POST',
  path: '/api/v1/filings/:draftId/application-text',
  access: { kind: 'action', action: 'filing.draft.edit' },
  params: z.strictObject({ draftId: z.uuid() }),
  resource: (p) => draftResource(p.draftId),
  bodyLimitBytes: SECURITY_POLICY.applicationText.maxBytes,
  body: z.strictObject({ text: z.string().min(1).max(SECURITY_POLICY.applicationText.maxChars) }),
  handler: ({ params: p, body, session }) =>
    withDraft(p.draftId, session, async (draft, caller) => answer(await pasteApplication(draft, body.text, caller.session.actor))),
});
