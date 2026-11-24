import 'server-only';
import type { ReplaceableComponent, RoleCode, VerificationStatus } from '@mahkama/core';

// Internal interface of professional-identity verification: is this person
// really a lawyer registered with a bar, a bailiff, an expert…? Today a
// simulated register answers «تم التحقق (محاكاة)»; later the national digital
// identity and the registers of the professional bodies, behind this interface.

export interface IdentityCheckRequest {
  readonly role: RoleCode;
  readonly fullName: string;
  readonly email: string;
  readonly organizationName: string | null;
}

export interface IdentityCheckResult {
  readonly status: VerificationStatus;
  readonly source: string;
}

export interface ProfessionalIdentityProvider {
  readonly component: ReplaceableComponent;
  verify(request: IdentityCheckRequest): Promise<IdentityCheckResult>;
}
