import type { RoleCode } from './roles';

export type VerificationStatus = 'VERIFIED_SIMULATED' | 'VERIFIED' | 'UNVERIFIED';

/** Who is asking. Built by the server from the session; never from client input. */
export type Subject =
  | { readonly kind: 'anonymous' }
  | {
      readonly kind: 'user';
      readonly userId: string;
      readonly role: RoleCode;
      readonly roleAssignmentId: string;
      readonly courtId: string | null;
      readonly organizationId: string | null;
      readonly isDemoAccount: boolean;
      readonly roleCount: number;
      readonly verificationStatus: VerificationStatus;
    };

export type UserSubject = Extract<Subject, { kind: 'user' }>;

/** The resource an action applies to, as far as authorization needs to know it. */
export type Resource =
  | { readonly kind: 'notification'; readonly ownerUserId: string }
  | {
      readonly kind: 'account';
      readonly userId: string;
      readonly isDemo: boolean;
      readonly activated: boolean;
      readonly disabled: boolean;
      readonly role: RoleCode | null;
    }
  /** the role is null when the request names no known role (the body is validated after authorization) */
  | { readonly kind: 'account-draft'; readonly role: RoleCode | null }
  | { readonly kind: 'demo-account'; readonly userId: string; readonly isDemo: boolean }
  | { readonly kind: 'case'; readonly caseFileId: string; readonly relatedUserIds: readonly string[] };

export type ResourceKind = Resource['kind'];

export interface AuthorizationContext {
  readonly mode: 'demo' | 'production';
  readonly demoToolsEnabled: boolean;
}
