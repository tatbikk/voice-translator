import { z } from 'zod';
import { ACTIONS } from '@mahkama/core';
import { executeCaseAction, executorKind } from '@/server/cases/executors';
import { caseResource } from '@/server/cases/resources';
import { clock } from '@/server/clock';
import { appendStandaloneEvent } from '@/server/events/append';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, ok } from '@/server/http/responses';

// The single route through which every action on a case file is requested. It
// runs the whole chain of checks, then the core decides on the file's snapshot:
// an action the state or the role does not allow is refused (and recorded),
// whoever sends it and however. An act whose executor is registered (Phase 2 on)
// is executed under the file's lock; an act that receives a document goes
// through the uploads route; any other is answered that it is not executed from
// this route (decision 46).
export const POST = defineEndpoint({
  id: 'cases.action',
  method: 'POST',
  path: '/api/v1/cases/:caseId/actions/:action',
  access: { kind: 'named-action', prefix: 'case.' },
  params: z.strictObject({ caseId: z.uuid(), action: z.string().regex(/^[a-z][a-z0-9.-]{2,80}$/) }),
  // Only a procedural act is named here; an access (case.view…) is unknown on this route (review P1-A-14).
  actionFrom: (params) => (ACTIONS[params.action]?.procedure ? params.action : 'unknown'),
  resource: (params) => caseResource(params.caseId, clock.now()),
  // Each executor validates its own body; here only its size and that it is an object.
  body: z.record(z.string(), z.unknown()),
  handler: async ({ params, body, session, subject, action }) => {
    const code = action ?? params.action;
    if (executorKind(code) === 'json' && subject.kind === 'user' && session) {
      const result = await executeCaseAction(code, params.caseId, subject, session.actor, { body, bytes: null, query: {} });
      return result.ok ? ok(result.data) : fail(result.status, result.code);
    }
    await appendStandaloneEvent({
      action: 'case.action.not-executed',
      details: { action: code },
      caseFileId: params.caseId,
      actor: session?.actor ?? null,
    });
    return fail(409, 'ACTION_NOT_EXECUTABLE_HERE');
  },
});
