import { z } from 'zod';
import { SECURITY_POLICY } from '@mahkama/core';
import { LOCALES } from '@/i18n/locales';
import { appendStandaloneEvent } from '@/server/events/append';
import { COOKIES, serializeCookie } from '@/server/http/cookies';
import { defineEndpoint } from '@/server/http/endpoint';
import { ok } from '@/server/http/responses';

const YEAR = 365 * 24 * 60 * 60;

// Language and reading-ease preferences of the visitor (cookies only). Like every
// state-changing endpoint, a success is written to the event log (contract §13.5).
export const POST = defineEndpoint({
  id: 'preferences.update',
  method: 'POST',
  path: '/api/v1/preferences',
  access: { kind: 'gate' },
  rateLimit: (clientIdHash) => ({ key: `preferences:client:${clientIdHash}`, rule: SECURITY_POLICY.preferencesPerClient }),
  body: z.object({
    locale: z.enum(LOCALES).optional(),
    readingSize: z.number().int().min(0).max(2).optional(),
    readingContrast: z.number().int().min(0).max(1).optional(),
  }),
  handler: async ({ body, session, clientIdHash }) => {
    await appendStandaloneEvent({
      action: 'preferences.updated',
      details: {
        locale: body.locale ?? null,
        readingSize: body.readingSize ?? null,
        readingContrast: body.readingContrast ?? null,
      },
      actor: session?.actor ?? null,
      clientIdHash,
    });
    const cookies: string[] = [];
    if (body.locale) cookies.push(serializeCookie(COOKIES.locale, body.locale, { httpOnly: false, maxAge: YEAR }));
    if (body.readingSize !== undefined || body.readingContrast !== undefined) {
      const value = `s${String(body.readingSize ?? 0)}c${String(body.readingContrast ?? 0)}`;
      cookies.push(serializeCookie(COOKIES.reading, value, { httpOnly: false, maxAge: YEAR }));
    }
    return ok({}, { cookies });
  },
});
