import { z } from 'zod';
import { safeInternalPath } from '@mahkama/core';
import { getEnv } from '@/server/config/env';
import { gateRequired, submitAccessCode } from '@/server/auth/access-gate';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, notFound, ok } from '@/server/http/responses';
import { nextPathSchema } from '@/server/http/schemas';

// «كلمة عبور الزوار»: the single passphrase that protects the demo environment.
export const POST = defineEndpoint({
  id: 'access.submit',
  method: 'POST',
  path: '/api/v1/access',
  access: { kind: 'pre-gate' },
  body: z.object({ code: z.string().min(1).max(256), next: nextPathSchema }),
  handler: async ({ body, clientIdHash }) => {
    if (!gateRequired()) return notFound();
    const result = await submitAccessCode(clientIdHash, body.code);
    if (result.kind === 'blocked') return fail(429, 'TOO_MANY_REQUESTS', { retryAfterSeconds: result.retryAfterSeconds });
    if (result.kind === 'rejected') return fail(401, 'ACCESS_CODE_INVALID');
    return ok({ next: safeInternalPath(body.next ?? '/', getEnv().appOrigin) }, { cookies: [result.cookie] });
  },
});
