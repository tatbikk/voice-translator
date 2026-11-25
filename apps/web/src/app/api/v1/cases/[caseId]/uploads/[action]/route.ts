import { z } from 'zod';
import { ACTIONS, SECURITY_POLICY } from '@mahkama/core';
import { executeCaseAction, executorKind } from '@/server/cases/executors';
import { caseResource } from '@/server/cases/resources';
import { clock } from '@/server/clock';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, ok } from '@/server/http/responses';

// The acts that file a document on a case (written conclusions of the
// prosecution, opinion of the royal commissioner): the same chain of checks as
// every act, the bytes read only once the act is authorized, within its limit,
// and their type read from their content (memo rows 7 to 10).
export const POST = defineEndpoint({
  id: 'cases.upload',
  method: 'POST',
  path: '/api/v1/cases/:caseId/uploads/:action',
  access: { kind: 'named-action', prefix: 'case.' },
  params: z.strictObject({
    caseId: z.uuid(),
    action: z.string().regex(/^[a-z][a-z0-9.-]{2,80}$/),
    name: z.string().min(1).max(255),
    title: z.string().trim().max(SECURITY_POLICY.uploads.titleMaxChars).optional(),
  }),
  // Only an act that files a document is named here; any other is unknown on this route.
  actionFrom: (params) => (ACTIONS[params.action]?.procedure?.files ? params.action : 'unknown'),
  resource: (params) => caseResource(params.caseId, clock.now()),
  binary: { absoluteMaxBytes: SECURITY_POLICY.uploads.conclusionsMaxBytes, maxBytes: () => SECURITY_POLICY.uploads.conclusionsMaxBytes },
  handler: async ({ params, session, subject, action, bytes }) => {
    const code = action ?? params.action;
    if (executorKind(code) !== 'upload' || subject.kind !== 'user' || !session) return fail(409, 'ACTION_NOT_EXECUTABLE_HERE');
    const query: Record<string, string> = { name: params.name, ...(params.title ? { title: params.title } : {}) };
    const result = await executeCaseAction(code, params.caseId, subject, session.actor, { body: null, bytes, query });
    return result.ok ? ok(result.data) : fail(result.status, result.code);
  },
});
