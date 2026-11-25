import { z } from 'zod';
import { SECURITY_POLICY } from '@mahkama/core';
import { defineEndpoint } from '@/server/http/endpoint';
import { ok } from '@/server/http/responses';
import { draftResource, draftView } from '@/server/filings/drafts';
import { answer, freshView, withDraft } from '@/server/filings/http';
import { UpdateDraftBody, updateDraft } from '@/server/filings/service';

const params = z.strictObject({ draftId: z.uuid() });

// The draft of a filing, to its author only (decision 56): the card, its
// documents, the fee, the payment and the checks before signature.
export const GET = defineEndpoint({
  id: 'filings.read',
  method: 'GET',
  path: '/api/v1/filings/:draftId',
  access: { kind: 'action', action: 'filing.draft.read' },
  params,
  resource: (p) => draftResource(p.draftId),
  handler: ({ params: p, session }) => withDraft(p.draftId, session, async (draft, caller) => ok(await draftView(draft, caller.subject))),
});

// A change of the draft: its court and case type, the card, the attestation of
// its sections, the bailiff. The claims are fixed once the fee is paid (decision 57).
export const POST = defineEndpoint({
  id: 'filings.update',
  method: 'POST',
  path: '/api/v1/filings/:draftId',
  access: { kind: 'action', action: 'filing.draft.edit' },
  params,
  resource: (p) => draftResource(p.draftId),
  bodyLimitBytes: SECURITY_POLICY.filingBody.maxBytes,
  body: UpdateDraftBody,
  handler: ({ params: p, body, session }) =>
    withDraft(p.draftId, session, async (draft, caller) => {
      const outcome = await updateDraft(draft, caller.subject, body, caller.session.actor);
      return outcome.ok ? freshView(draft.id, caller.subject) : answer(outcome);
    }),
});
