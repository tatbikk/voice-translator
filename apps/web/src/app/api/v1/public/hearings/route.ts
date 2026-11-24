import { z } from 'zod';
import { hearingsOn } from '@/server/public/service';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, ok } from '@/server/http/responses';
import { uuidSchema } from '@/server/http/schemas';

// «جدول الجلسات»: time, room, panel and case numbers; never a party name.
export const GET = defineEndpoint({
  id: 'public.hearings',
  method: 'GET',
  path: '/api/v1/public/hearings',
  access: { kind: 'gate' },
  params: z.object({ courtId: uuidSchema, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  handler: async ({ params, clientIdHash }) => {
    const result = await hearingsOn(clientIdHash, params.courtId, params.date);
    if (result.kind === 'throttled') return fail(429, 'TOO_MANY_REQUESTS', { retryAfterSeconds: result.retryAfterSeconds });
    if (result.kind === 'not-found') return fail(404, 'NOT_FOUND');
    return ok({
      hearings: result.value.map((h) => ({
        startsAt: h.startsAt.toISOString(),
        room: h.room,
        panelName: h.panelName,
        caseNumbers: h.caseNumbers,
      })),
    });
  },
});
