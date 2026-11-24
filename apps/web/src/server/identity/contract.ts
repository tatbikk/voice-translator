import 'server-only';
import { ROLE_CODES } from '@mahkama/core';
import type { ContractCheck } from '../messaging/contract';
import type { ProfessionalIdentityProvider } from './provider';

// Contract every implementation of ProfessionalIdentityProvider must pass,
// run by tests/integration/contracts.test.ts against every implementation.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`identity contract: ${message}`);
}

export const IDENTITY_CONTRACT: readonly ContractCheck<ProfessionalIdentityProvider>[] = [
  {
    name: 'describes itself as a replaceable component',
    run: async (provider) => {
      await Promise.resolve();
      assert(provider.component.id === 'professional-identity', 'component id');
      assert(['simulated', 'real', 'test'].includes(provider.component.implementation), 'implementation kind');
    },
  },
  {
    name: 'answers with a known status and a source for every role',
    run: async (provider) => {
      for (const role of ROLE_CODES) {
        const result = await provider.verify({
          role,
          fullName: 'probe',
          email: 'probe@demo.mahkama.example',
          organizationName: null,
        });
        assert(['VERIFIED_SIMULATED', 'VERIFIED', 'UNVERIFIED'].includes(result.status), `status for ${role}`);
        assert(result.source.length > 0, `source for ${role}`);
        if (provider.component.implementation !== 'real') {
          assert(result.status !== 'VERIFIED', 'only a real provider may claim a real verification');
        }
      }
    },
  },
];
