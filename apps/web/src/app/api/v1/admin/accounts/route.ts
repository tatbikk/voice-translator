import { z } from 'zod';
import { SECURITY_POLICY, isRoleCode } from '@mahkama/core';
import { createAccount, listAccounts } from '@/server/accounts/service';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, ok } from '@/server/http/responses';
import { emailSchema, nameSchema, phoneSchema, uuidSchema } from '@/server/http/schemas';

export const GET = defineEndpoint({
  id: 'admin.accounts.list',
  method: 'GET',
  path: '/api/v1/admin/accounts',
  access: { kind: 'action', action: 'admin.accounts.list' },
  handler: async () => ok({ accounts: await listAccounts() }),
});

// «إنشاء حساب»: on a documented request, after re-authentication.
export const POST = defineEndpoint({
  id: 'admin.accounts.create',
  method: 'POST',
  path: '/api/v1/admin/accounts',
  access: { kind: 'action', action: 'admin.accounts.create' },
  recentAuthMinutes: SECURITY_POLICY.reauth.windowMs / 60_000,
  // The draft carries the requested role when it is a known one, so that the
  // decision (and later rules by role) see it; an unknown role is refused at step 10.
  resource: async (_params, { rawBody }) => {
    await Promise.resolve();
    const role: unknown = typeof rawBody === 'object' && rawBody !== null ? (rawBody as Record<string, unknown>).role : undefined;
    return { kind: 'account-draft', role: isRoleCode(role) ? role : null };
  },
  body: z.object({
    fullName: nameSchema,
    email: emailSchema,
    phone: phoneSchema,
    role: z.string().regex(/^[A-Z_]{2,40}$/),
    courtId: uuidSchema.optional(),
    organizationName: z.string().trim().max(SECURITY_POLICY.fields.name).optional(),
    requestReference: z
      .string()
      .trim()
      .min(SECURITY_POLICY.fields.requestReferenceMin)
      .max(SECURITY_POLICY.fields.requestReferenceMax),
  }),
  handler: async ({ body, session, clientIdHash }) => {
    if (!session) return fail(401, 'SESSION_REQUIRED');
    const result = await createAccount(body, { actor: session.actor, sessionId: session.session.id, clientIdHash });
    if (result.kind === 'invalid') return fail(422, 'INVALID_INPUT', { fields: result.fields });
    if (result.kind === 'not-combinable') return fail(409, 'ROLE_NOT_COMBINABLE');
    return ok({ userId: result.userId, activationSent: result.activationSent });
  },
});
