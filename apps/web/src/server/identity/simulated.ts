import 'server-only';
import type { ReplaceableComponent } from '@mahkama/core';
import type { IdentityCheckRequest, IdentityCheckResult, ProfessionalIdentityProvider } from './provider';

export const SIMULATED_IDENTITY_COMPONENT: ReplaceableComponent = {
  id: 'professional-identity',
  nameKey: 'components.identity.name',
  descriptionKey: 'components.identity.description',
  replacementKey: 'components.identity.replacement',
  implementation: 'simulated',
};

export function createSimulatedIdentityProvider(): ProfessionalIdentityProvider {
  return {
    component: SIMULATED_IDENTITY_COMPONENT,
    async verify(_request: IdentityCheckRequest): Promise<IdentityCheckResult> {
      await Promise.resolve();
      return { status: 'VERIFIED_SIMULATED', source: 'simulated-register' };
    },
  };
}
