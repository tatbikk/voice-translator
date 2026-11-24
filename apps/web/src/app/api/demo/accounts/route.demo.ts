import { SECURITY_POLICY } from '@mahkama/core';
import { defineEndpoint } from '@/server/http/endpoint';
import { ok } from '@/server/http/responses';

// Demo accounts offered by the account switcher. Built only with DEMO_BUILD=true.
export const GET = defineEndpoint({
  id: 'demo.accounts',
  method: 'GET',
  path: '/api/demo/accounts',
  access: { kind: 'demo', action: 'demo.accounts.list' },
  rateLimit: (clientIdHash) => ({ key: `demo:client:${clientIdHash}`, rule: SECURITY_POLICY.demoEndpoints.perClient }),
  handler: async () => {
    const { demoAccounts } = await import('@/demo/server/services');
    return ok({ accounts: await demoAccounts() });
  },
});
