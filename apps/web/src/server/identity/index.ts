import 'server-only';
import type { ProfessionalIdentityProvider } from './provider';
import { createSimulatedIdentityProvider } from './simulated';

let provider: ProfessionalIdentityProvider | null = null;

export function professionalIdentity(): ProfessionalIdentityProvider {
  provider ??= createSimulatedIdentityProvider();
  return provider;
}

export function setIdentityProviderForTests(next: ProfessionalIdentityProvider | null): void {
  provider = next;
}

export type { ProfessionalIdentityProvider, IdentityCheckRequest, IdentityCheckResult } from './provider';
