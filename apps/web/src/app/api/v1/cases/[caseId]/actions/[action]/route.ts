import { z } from 'zod';
import { caseResource } from '@/server/cases/resources';
import { clock } from '@/server/clock';
import { appendStandaloneEvent } from '@/server/events/append';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail } from '@/server/http/responses';

// The single route through which every action on a case file is requested. It
// runs the whole chain of checks, then the core decides on the file's snapshot:
// an action the state or the role does not allow is refused (and recorded),
// whoever sends it and however. The action's execution is registered with its
// screen, from Phase 2 on; until then an allowed action is answered that it is
// not executed from this route (decision 45).
export const POST = defineEndpoint({
  id: 'cases.action',
  method: 'POST',
  path: '/api/v1/cases/:caseId/actions/:action',
  access: { kind: 'named-action', prefix: 'case.' },
  params: z.strictObject({ caseId: z.uuid(), action: z.string().regex(/^[a-z][a-z0-9.-]{2,80}$/) }),
  actionFrom: (params) => params.action,
  resource: (params) => caseResource(params.caseId, clock.now()),
  body: z.strictObject({}),
  handler: async ({ params, session, action }) => {
    await appendStandaloneEvent({
      action: 'case.action.not-executed',
      details: { action: action ?? params.action },
      caseFileId: params.caseId,
      actor: session?.actor ?? null,
    });
    return fail(409, 'ACTION_NOT_EXECUTABLE_HERE');
  },
});
