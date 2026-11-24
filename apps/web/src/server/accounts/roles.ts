import 'server-only';
import { getDb } from '../db';

export interface RoleView {
  readonly id: string;
  readonly role: string;
  readonly courtName: string | null;
  readonly courtDegree: 'FIRST_INSTANCE' | 'APPEAL' | null;
  readonly verificationStatus: 'VERIFIED_SIMULATED' | 'VERIFIED' | 'UNVERIFIED';
}

/** The active role assignments of a user, with their court. */
export async function rolesOf(userId: string): Promise<RoleView[]> {
  const rows = await getDb().roleAssignment.findMany({
    where: { userId, revokedAt: null },
    include: { court: { select: { name: true, degree: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    courtName: r.court?.name ?? null,
    courtDegree: r.court?.degree ?? null,
    verificationStatus: r.verificationStatus,
  }));
}
