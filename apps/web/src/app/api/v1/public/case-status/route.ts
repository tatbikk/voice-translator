import { z } from 'zod';
import { parseCaseNumberParts } from '@mahkama/core';
import { caseStatus } from '@/server/public/service';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, ok } from '@/server/http/responses';
import { uuidSchema } from '@/server/http/schemas';

// «تتبع الملف»: state and next hearing only — no document, no party name.
export const GET = defineEndpoint({
  id: 'public.case-status',
  method: 'GET',
  path: '/api/v1/public/case-status',
  access: { kind: 'gate' },
  params: z.object({
    courtId: uuidSchema,
    number: z.string().max(12),
    code: z.string().max(8),
    year: z.string().max(8),
  }),
  handler: async ({ params, clientIdHash }) => {
    const number = parseCaseNumberParts(params.number, params.code, params.year);
    if (!number) return fail(422, 'INVALID_INPUT', { fields: { number: 'errors.field.invalid' } });
    const result = await caseStatus(clientIdHash, params.courtId, number);
    if (result.kind === 'throttled') return fail(429, 'TOO_MANY_REQUESTS', { retryAfterSeconds: result.retryAfterSeconds });
    if (result.kind === 'not-found') return fail(404, 'CASE_NOT_FOUND');
    return ok({ status: result.value.status, nextHearingAt: result.value.nextHearingAt?.toISOString() ?? null });
  },
});
