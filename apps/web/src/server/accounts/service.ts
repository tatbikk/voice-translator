import 'server-only';
import { ROLES, accountCreationBasis, canCombineRoles, isRoleCode, roleLabelKey, type CourtDegree, type RoleCode } from '@mahkama/core';
import type { OrganizationKind } from '@/generated/prisma/client';
import { clock } from '../clock';
import { getDb } from '../db';
import { appendEvent, eventTransaction, type EventActor } from '../events/append';
import { professionalIdentity } from '../identity';
import { messaging } from '../messaging';
import { createNotification } from '../notifications/service';
import { activationExpiresAt, activationLink, createActivationToken } from '../auth/activation';
import { sha256Hex } from '../auth/tokens';

// Account administration (contract §6): the system administrator creates an
// account with any role, on a documented request, after re-authenticating.
// Accounts created this way are never demo accounts. Every creation is logged
// with its legal basis and notified to every other administrator.

const ORGANIZATION_KIND: Partial<Record<RoleCode, OrganizationKind>> = {
  LAWYER_ASSISTANT: 'LAW_FIRM',
  PUBLIC_ADMIN_SUPERVISOR: 'PUBLIC_ADMINISTRATION',
  PUBLIC_ADMIN_LITIGATION: 'PUBLIC_ADMINISTRATION',
  STATE_JUDICIAL_AGENT: 'STATE_JUDICIAL_AGENCY',
  GARNISHEE_BANK: 'BANK',
};

export interface AccountListItem {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly isDemo: boolean;
  readonly activated: boolean;
  readonly disabled: boolean;
  readonly roles: readonly { readonly role: RoleCode; readonly courtName: string | null; readonly courtDegree: 'FIRST_INSTANCE' | 'APPEAL' | null }[];
}

export async function listAccounts(): Promise<AccountListItem[]> {
  const users = await getDb().user.findMany({
    orderBy: [{ isDemo: 'asc' }, { fullName: 'asc' }],
    include: { roles: { where: { revokedAt: null }, include: { court: true } } },
    take: 500,
  });
  return users.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    isDemo: u.isDemo,
    activated: u.passwordHash !== null,
    disabled: u.disabledAt !== null,
    roles: u.roles.map((r) => ({
      role: r.role,
      courtName: r.court?.name ?? null,
      courtDegree: r.court?.degree ?? null,
    })),
  }));
}

export async function listCourts(): Promise<{ id: string; name: string; degree: 'FIRST_INSTANCE' | 'APPEAL' }[]> {
  return getDb().court.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, degree: true } });
}

export interface CreateAccountInput {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly role: string;
  readonly courtId?: string | undefined;
  readonly organizationName?: string | undefined;
  readonly requestReference: string;
}

export type CreateAccountResult =
  | { kind: 'created'; userId: string; activationSent: boolean }
  | { kind: 'invalid'; fields: Record<string, string> }
  | { kind: 'not-combinable' };

export async function createAccount(
  input: CreateAccountInput,
  admin: { actor: EventActor; sessionId: string; clientIdHash: string },
): Promise<CreateAccountResult> {
  if (!isRoleCode(input.role)) return { kind: 'invalid', fields: { role: 'errors.field.invalid' } };
  const role = input.role;
  const definition = ROLES[role];
  const db = getDb();
  const email = input.email.trim().toLowerCase();

  let courtId: string | null = null;
  let courtDegree: CourtDegree | null = null;
  if (definition.requiresCourt) {
    const court = input.courtId ? await db.court.findUnique({ where: { id: input.courtId } }) : null;
    if (!court) return { kind: 'invalid', fields: { courtId: 'errors.field.required' } };
    courtId = court.id;
    courtDegree = court.degree;
  }
  const roleKey = roleLabelKey(role, courtDegree);
  const organizationKind = ORGANIZATION_KIND[role];
  if (definition.requiresOrganization && !input.organizationName?.trim()) {
    return { kind: 'invalid', fields: { organizationName: 'errors.field.required' } };
  }

  const existing = await db.user.findUnique({
    where: { email },
    include: { roles: { where: { revokedAt: null } } },
  });
  if (existing && !canCombineRoles(existing.roles.map((r) => r.role), role)) {
    return { kind: 'not-combinable' };
  }

  const verification = await professionalIdentity().verify({
    role,
    fullName: input.fullName,
    email,
    organizationName: input.organizationName ?? null,
  });
  const legalBasis = accountCreationBasis({ kind: 'account-draft', role });

  const result = await eventTransaction(async (tx) => {
    const user =
      existing ??
      (await tx.user.create({
        data: {
          email,
          fullName: input.fullName.trim(),
          phone: input.phone.trim(),
          isDemo: false,
          createdByUserId: admin.actor.userId,
          createdInSessionId: admin.sessionId,
          createdAt: clock.now(),
        },
      }));
    const organization =
      organizationKind && input.organizationName
        ? await tx.organization.create({ data: { kind: organizationKind, name: input.organizationName.trim(), createdAt: clock.now() } })
        : null;
    await tx.roleAssignment.create({
      data: {
        userId: user.id,
        role,
        courtId,
        organizationId: organization?.id ?? null,
        verificationStatus: verification.status,
        verificationSource: verification.source,
        createdAt: clock.now(),
      },
    });
    const token = existing?.passwordHash ? null : await createActivationToken(tx, user.id, admin.actor.userId);
    await createNotification(tx, {
      userId: user.id,
      kind: 'INFORMATION',
      templateKey: 'notifications.roleGranted',
      params: { roleKey },
    });
    const otherAdmins = await tx.roleAssignment.findMany({
      where: { role: 'SYSTEM_ADMIN', revokedAt: null, userId: { not: admin.actor.userId } },
      select: { userId: true },
    });
    for (const other of otherAdmins) {
      await createNotification(tx, {
        userId: other.userId,
        kind: 'INFORMATION',
        templateKey: 'notifications.adminAccountCreated',
        params: { roleKey },
        targetPath: '/admin/accounts',
      });
    }
    const requestReferenceHash = sha256Hex(input.requestReference.trim());
    if (existing) {
      // A role added to an account that already existed is not a new account.
      await appendEvent(tx, {
        action: 'admin.role.granted',
        details: { userId: user.id, role, courtId, requestReferenceHash },
        actor: admin.actor,
        clientIdHash: admin.clientIdHash,
        legalBasis,
      });
    } else {
      await appendEvent(tx, {
        action: 'admin.account.created',
        details: { newUserId: user.id, role, courtId, requestReferenceHash },
        actor: admin.actor,
        clientIdHash: admin.clientIdHash,
        legalBasis,
      });
    }
    return { user, token };
  });

  if (result.token) {
    await messaging().send({
      channel: 'EMAIL',
      recipientUserId: result.user.id,
      recipientAddress: result.user.email,
      templateKey: 'messages.email.activation',
      params: { link: activationLink(result.token) },
      holdsSecret: true,
      expiresAt: activationExpiresAt(),
      // A non-demo account's links are shown only to the session that created the
      // account, whoever asks for a new one: in the demo environment, where every
      // visitor can act as the demo administrator, nobody else can obtain them (S-06).
      visibleToSessionId: result.user.isDemo ? null : result.user.createdInSessionId,
    });
  }
  return { kind: 'created', userId: result.user.id, activationSent: result.token !== null };
}

export async function accountResource(userId: string) {
  const user = await getDb().user.findUnique({
    where: { id: userId },
    include: { roles: { where: { revokedAt: null }, orderBy: { createdAt: 'asc' }, take: 1 } },
  });
  if (!user) return null;
  return {
    kind: 'account' as const,
    userId: user.id,
    isDemo: user.isDemo,
    activated: user.passwordHash !== null,
    disabled: user.disabledAt !== null,
    role: (user.roles[0]?.role) ?? null,
  };
}

export async function reissueActivation(
  userId: string,
  admin: { actor: EventActor; sessionId: string; clientIdHash: string },
): Promise<void> {
  const db = getDb();
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await eventTransaction(async (tx) => {
    const created = await createActivationToken(tx, user.id, admin.actor.userId);
    await appendEvent(tx, {
      action: 'admin.account.activation-reissued',
      details: { userId: user.id },
      actor: admin.actor,
      clientIdHash: admin.clientIdHash,
    });
    return created;
  });
  await messaging().send({
    channel: 'EMAIL',
    recipientUserId: user.id,
    recipientAddress: user.email,
    templateKey: 'messages.email.activation',
    params: { link: activationLink(token) },
    holdsSecret: true,
    expiresAt: activationExpiresAt(),
    visibleToSessionId: user.isDemo ? null : user.createdInSessionId,
  });
}
