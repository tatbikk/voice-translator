import { z } from 'zod';
import { resolveLocale } from '@/i18n/locales';
import { translator } from '@/i18n/translate';
import { actionViews } from '@/server/cases/actions-view';
import { caseResource } from '@/server/cases/resources';
import { clock } from '@/server/clock';
import { getEnv } from '@/server/config/env';
import { COOKIES, readCookie } from '@/server/http/cookies';
import { defineEndpoint } from '@/server/http/endpoint';
import { notFound, ok } from '@/server/http/responses';

// «الإجراءات المتاحة» (prompt, Phase 1): the buttons the core grants the session's
// role in the file's current state, with their confirmation lines.
export const GET = defineEndpoint({
  id: 'cases.available-actions',
  method: 'GET',
  path: '/api/v1/cases/:caseId/available-actions',
  access: { kind: 'action', action: 'case.view' },
  params: z.strictObject({ caseId: z.uuid() }),
  resource: (params) => caseResource(params.caseId, clock.now()),
  handler: async ({ req, subject, resource }) => {
    if (!resource) return notFound();
    const env = getEnv();
    const t = translator(resolveLocale(readCookie(req, COOKIES.locale)));
    const actions = actionViews(t, subject, resource, { mode: env.mode, demoToolsEnabled: env.demoToolsEnabled, now: clock.now() });
    return ok({ actions });
  },
});
