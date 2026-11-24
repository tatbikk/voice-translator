import 'server-only';
import type { ContractCheck } from '../messaging/contract';
import type { ProfessionalIdentityProvider } from './provider';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`identity contract: ${message}`);
}

export const IDENTITY_CONTRACT: readonly ContractCheck<ProfessionalIdentityProvider>[] = [
  {
    name: 'describes itself as a replaceable component',
    run: async (provider) => {
      await Promise.resolve();
      assert(provider.component.id === 'professional-identity', 'component id');
    },
  },
  {
    name: 'answers with a known status and a source for every professional role',
    run: async (provider) => {
      for (const role of ['LAWYER', 'BAILIFF', 'EXPERT'] as const) {
        const result = await provider.verify({
          role,
          fullName: 'probe',
          email: 'probe@demo.mahkama.example',
          organizationName: null,
        });
        assert(['VERIFIED_SIMULATED', 'VERIFIED', 'UNVERIFIED'].includes(result.status), 'status');
        assert(result.source.length > 0, 'source');
        if (provider.component.implementation === 'simulated') {
          assert(result.status !== 'VERIFIED', 'a simulated provider never claims a real verification');
        }
      }
    },
  },
];
