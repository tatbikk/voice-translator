import { SECURITY_POLICY } from '@mahkama/core';
import { defineEndpoint } from '@/server/http/endpoint';
import { ok } from '@/server/http/responses';

// «صندوق الرسائل الصادرة» (demo tool). Built only with DEMO_BUILD=true.
export const GET = defineEndpoint({
  id: 'demo.outbox',
  method: 'GET',
  path: '/api/demo/outbox',
  access: { kind: 'demo', action: 'demo.outbox.view' },
  rateLimit: (clientIdHash) => ({ key: `demo:client:${clientIdHash}`, rule: SECURITY_POLICY.demoEndpoints.perClient }),
  handler: async ({ session, clientIdHash }) => {
    const { outboxFor } = await import('@/demo/server/services');
    const items = await outboxFor(session?.session.id ?? null, session?.actor ?? null, clientIdHash);
    return ok({ items: items.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })) });
  },
});
