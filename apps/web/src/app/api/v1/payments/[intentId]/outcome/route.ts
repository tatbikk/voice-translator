import { z } from 'zod';
import { SECURITY_POLICY } from '@mahkama/core';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, notFound, ok } from '@/server/http/responses';
import { callerOf } from '@/server/filings/http';
import { intentResource, settlePayment } from '@/server/payments/service';

// The page «أداء (محاكاة)»: the payer chooses the gateway's answer. The amount
// is the one the platform fixed when the payment was opened; the outcome is
// recorded once (memo rows 4 and 5).
export const POST = defineEndpoint({
  id: 'payments.outcome',
  method: 'POST',
  path: '/api/v1/payments/:intentId/outcome',
  access: { kind: 'action', action: 'payment.simulate' },
  params: z.strictObject({ intentId: z.uuid() }),
  resource: (p) => intentResource(p.intentId),
  // The payer's own page, open after its payment lapsed or was recorded: said so (fix review L6).
  conditionAnswer: (resource) =>
    resource.kind === 'payment-intent' ? { status: 409, code: resource.status === 'EXPIRED' ? 'PAYMENT_LAPSED' : 'PAYMENT_ALREADY_COMPLETED' } : null,
  rateLimit: (_client, session) => ({ key: `filing-writes:session:${session?.session.id ?? 'none'}`, rule: SECURITY_POLICY.filing.writesPerSession }),
  body: z.strictObject({ outcome: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED']) }),
  handler: async ({ params: p, body, session }) => {
    const caller = callerOf(session);
    if (!caller) return notFound();
    const settled = await settlePayment(p.intentId, caller.subject, body.outcome, caller.session.actor);
    if (!settled.ok) return fail(409, settled.code);
    return ok({ status: settled.status, operationRef: settled.operationRef, paymentId: settled.paymentId, amountCents: settled.amountCents });
  },
});
