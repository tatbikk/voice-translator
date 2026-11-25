import { z } from 'zod';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, ok } from '@/server/http/responses';
import { draftResource } from '@/server/filings/drafts';
import { withDraft } from '@/server/filings/http';
import { openPayment } from '@/server/payments/service';

// «أداء الرسم»: the platform computes the amount from the claims and opens the
// payment on the gateway; the body names nothing, the amount least of all
// (memo row 4).
export const POST = defineEndpoint({
  id: 'filings.payment.open',
  method: 'POST',
  path: '/api/v1/filings/:draftId/payment',
  access: { kind: 'action', action: 'filing.draft.pay' },
  params: z.strictObject({ draftId: z.uuid() }),
  resource: (p) => draftResource(p.draftId),
  body: z.strictObject({}),
  handler: ({ params: p, session }) =>
    withDraft(p.draftId, session, async (draft, caller) => {
      const opened = await openPayment(draft, caller.subject, caller.session.actor);
      return opened.ok ? ok({ intentId: opened.intentId, amountCents: opened.amountCents }) : fail(opened.status, opened.code);
    }),
});
