// Fixtures written directly through the OWNER connection: courts, panels,
// organizations, users with their roles, notifications, case files, hearings
// and the database stamp. Passwords are hashed exactly as the platform hashes
// them (contract §1: Argon2id, m=19456, t=2, p=1, 32-byte output).
import { randomBytes, randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { ROLES, type RoleCode } from '@mahkama/core';
import { one, sql } from './db';
import { trackSensitive } from './sensitive';

/**
 * Template of the notifications created by the factory. The notification API
 * and pages must accept it; change it here if the catalogue names the
 * "account created" information notice differently.
 */
export const FACTORY_NOTIFICATION_TEMPLATE = 'notifications.accountCreated';

const RUN = randomBytes(3).toString('hex');
let counter = 0;
const next = () => {
  counter += 1;
  return counter;
};

const hashCache = new Map<string, Promise<string>>();

export function hashPassword(password: string): Promise<string> {
  let pending = hashCache.get(password);
  if (!pending) {
    // Argon2id: the const enum cannot be referenced under isolatedModules (contract §1).
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment
    pending = hash(password, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
    hashCache.set(password, pending);
  }
  return pending;
}

/** A password that satisfies the platform policy (12–128 characters). */
export function newPassword(): string {
  const password = `Pw-${randomBytes(12).toString('base64url')}-7q`;
  trackSensitive('password', password);
  return password;
}

export function newEmail(label = 'user'): string {
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${String(next())}.${RUN}@itest.mahkama.example`;
  trackSensitive('email', email);
  return email;
}

function newPhone(): string {
  const digits = String(10_000_000 + ((next() * 7919 + Number.parseInt(RUN, 16)) % 89_999_999));
  const phone = `+2126${digits}`;
  trackSensitive('phone', phone);
  return phone;
}

function newName(): string {
  const name = `مستعمل تجريبي ${String(next())} ${RUN}`;
  trackSensitive('name', name);
  return name;
}

// ---------------------------------------------------------------------------
// Courts, panels, organizations

export interface CourtFixture {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly degree: 'FIRST_INSTANCE' | 'APPEAL';
}

export async function createCourt(options: { degree?: 'FIRST_INSTANCE' | 'APPEAL'; name?: string } = {}): Promise<CourtFixture> {
  const id = randomUUID();
  const degree = options.degree ?? 'FIRST_INSTANCE';
  const code = `T${RUN}${String(next())}`;
  const name = options.name ?? `محكمة الاختبار ${code}`;
  await sql('INSERT INTO "Court" (id, code, name, degree) VALUES ($1, $2, $3, $4::"CourtDegree")', [id, code, name, degree]);
  return { id, code, name, degree };
}

export async function createPanel(courtId: string, kind: 'COLLEGIAL' | 'SINGLE' = 'COLLEGIAL'): Promise<string> {
  const id = randomUUID();
  await sql('INSERT INTO "Panel" (id, "courtId", name, kind) VALUES ($1, $2, $3, $4::"PanelKind")', [
    id,
    courtId,
    `هيئة الاختبار ${String(next())}`,
    kind,
  ]);
  return id;
}

type OrganizationKind = 'LAW_FIRM' | 'BANK' | 'PUBLIC_ADMINISTRATION' | 'STATE_JUDICIAL_AGENCY' | 'EXPERT_OFFICE' | 'BAILIFF_OFFICE';

export async function createOrganization(kind: OrganizationKind, isDemo = false): Promise<string> {
  const id = randomUUID();
  await sql('INSERT INTO "Organization" (id, kind, name, "isDemo") VALUES ($1, $2::"OrganizationKind", $3, $4)', [
    id,
    kind,
    `جهة الاختبار ${String(next())}`,
    isDemo,
  ]);
  return id;
}

const ORGANIZATION_OF_ROLE: Partial<Record<RoleCode, OrganizationKind>> = {
  LAWYER_ASSISTANT: 'LAW_FIRM',
  PUBLIC_ADMIN_SUPERVISOR: 'PUBLIC_ADMINISTRATION',
  PUBLIC_ADMIN_LITIGATION: 'PUBLIC_ADMINISTRATION',
  STATE_JUDICIAL_AGENT: 'STATE_JUDICIAL_AGENCY',
  GARNISHEE_BANK: 'BANK',
};

let defaultCourt: Promise<CourtFixture> | null = null;
const defaultOrganizations = new Map<OrganizationKind, Promise<string>>();

/** One first-instance court per test file, created on first use. Call forgetDefaults() after a schema reset. */
export function theCourt(): Promise<CourtFixture> {
  defaultCourt ??= createCourt();
  return defaultCourt;
}

function theOrganization(kind: OrganizationKind): Promise<string> {
  let pending = defaultOrganizations.get(kind);
  if (!pending) {
    pending = createOrganization(kind);
    defaultOrganizations.set(kind, pending);
  }
  return pending;
}

export function forgetDefaults(): void {
  defaultCourt = null;
  defaultOrganizations.clear();
}

// ---------------------------------------------------------------------------
// Users and roles

export interface RoleSpec {
  readonly role: RoleCode;
  readonly courtId?: string | null;
  readonly organizationId?: string | null;
  readonly revoked?: boolean;
}

export interface TestUser {
  readonly id: string;
  readonly email: string;
  /** null for an account that has not been activated yet */
  readonly password: string | null;
  readonly fullName: string;
  readonly phone: string;
  readonly isDemo: boolean;
  readonly roles: readonly { readonly id: string; readonly role: RoleCode }[];
  /** the first role assignment */
  readonly roleAssignmentId: string;
}

export interface UserOptions {
  readonly roles: readonly (RoleCode | RoleSpec)[];
  readonly email?: string;
  /** a password, or null for an account not yet activated (no password hash) */
  readonly password?: string | null;
  readonly isDemo?: boolean;
  readonly disabled?: boolean;
  /** creates one INFORMATION notification for the user (default true) */
  readonly notification?: boolean;
  readonly label?: string;
}

export async function createUser(options: UserOptions): Promise<TestUser> {
  const specs = options.roles.map((r) => (typeof r === 'string' ? { role: r } : r));
  const id = randomUUID();
  const email = options.email ?? newEmail(options.label ?? specs[0]?.role ?? 'user');
  trackSensitive('email', email);
  const password = options.password === undefined ? newPassword() : options.password;
  if (password !== null) trackSensitive('password', password);
  const fullName = newName();
  const phone = newPhone();
  const isDemo = options.isDemo ?? true;
  await sql(
    `INSERT INTO "User" (id, email, "fullName", phone, "passwordHash", "isDemo", "disabledAt")
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() ELSE NULL END)`,
    [id, email, fullName, phone, password === null ? null : await hashPassword(password), isDemo, options.disabled ?? false],
  );
  const roles: { id: string; role: RoleCode }[] = [];
  for (const spec of specs) {
    const definition = ROLES[spec.role];
    const courtId = spec.courtId !== undefined ? spec.courtId : definition.requiresCourt ? (await theCourt()).id : null;
    const organizationKind = ORGANIZATION_OF_ROLE[spec.role];
    const organizationId =
      spec.organizationId !== undefined
        ? spec.organizationId
        : definition.requiresOrganization && organizationKind
          ? await theOrganization(organizationKind)
          : null;
    const roleId = randomUUID();
    await sql(
      `INSERT INTO "RoleAssignment" (id, "userId", role, "courtId", "organizationId", "verificationStatus", "verificationSource", "revokedAt")
       VALUES ($1, $2, $3::"RoleCode", $4, $5, 'VERIFIED_SIMULATED', 'test-fixture', CASE WHEN $6 THEN now() ELSE NULL END)`,
      [roleId, id, spec.role, courtId, organizationId, spec.revoked ?? false],
    );
    roles.push({ id: roleId, role: spec.role });
  }
  if (options.notification ?? true) await createNotification(id);
  const first = roles[0];
  if (!first) throw new Error('createUser: at least one role is required');
  return { id, email, password, fullName, phone, isDemo, roles, roleAssignmentId: first.id };
}

export function roleAssignmentOf(user: TestUser, role: RoleCode): string {
  const found = user.roles.find((r) => r.role === role);
  if (!found) throw new Error(`user has no ${role} role`);
  return found.id;
}

export async function createNotification(
  userId: string,
  options: { kind?: 'LEGAL_NOTIFICATION' | 'INFORMATION' | 'REMINDER'; templateKey?: string; createdAt?: Date } = {},
): Promise<string> {
  const id = randomUUID();
  await sql(
    `INSERT INTO "Notification" (id, "userId", kind, "templateKey", params, "createdAt")
     VALUES ($1, $2, $3::"NotificationKind", $4, '{}'::jsonb, COALESCE($5::timestamptz, now()))`,
    [id, userId, options.kind ?? 'INFORMATION', options.templateKey ?? FACTORY_NOTIFICATION_TEMPLATE, options.createdAt ?? null],
  );
  return id;
}

export async function disableUser(userId: string): Promise<void> {
  await sql('UPDATE "User" SET "disabledAt" = now() WHERE id = $1', [userId]);
}

export async function revokeRole(roleAssignmentId: string): Promise<void> {
  await sql('UPDATE "RoleAssignment" SET "revokedAt" = now() WHERE id = $1', [roleAssignmentId]);
}

export async function userIdByEmail(email: string): Promise<string> {
  const row = await one<{ id: string }>('SELECT id FROM "User" WHERE lower(email) = lower($1)', [email]);
  return row.id;
}

// ---------------------------------------------------------------------------
// Case files and hearings

export interface CaseFileFixture {
  readonly id: string;
  readonly courtId: string;
  readonly number: number;
  readonly code: number;
  readonly year: number;
  readonly status: string;
  readonly hearingId: string | null;
}

export async function createHearing(courtId: string, startsAt: Date, room = 'القاعة 3'): Promise<string> {
  const id = randomUUID();
  const panelId = await createPanel(courtId);
  await sql('INSERT INTO "Hearing" (id, "courtId", "panelId", room, "startsAt", "isDemo") VALUES ($1, $2, $3, $4, $5, true)', [
    id,
    courtId,
    panelId,
    room,
    startsAt,
  ]);
  return id;
}

export async function createCaseFile(
  options: { courtId: string; status?: string; hearingId?: string | null; number?: number; code?: number; year?: number },
): Promise<CaseFileFixture> {
  const id = randomUUID();
  const number = options.number ?? 1000 + next();
  const code = options.code ?? 8201;
  const year = options.year ?? 2026;
  const status = options.status ?? 'REGISTERED';
  await sql(
    `INSERT INTO "CaseFile" (id, "nationalRef", "courtId", number, code, year, status, "nextHearingId", "isDemo", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7::"CaseStatus", $8, true, now())`,
    [id, `NR-${RUN}-${String(next())}`, options.courtId, number, code, year, status, options.hearingId ?? null],
  );
  return { id, courtId: options.courtId, number, code, year, status, hearingId: options.hearingId ?? null };
}

// ---------------------------------------------------------------------------
// System state

/** Sets the one-way database stamp (the trigger refuses any later change). */
export async function stampDatabase(mode: 'demo' | 'production'): Promise<void> {
  await sql(`UPDATE "SystemState" SET "databaseMode" = $1, "updatedAt" = now() WHERE id = 1`, [mode]);
}
