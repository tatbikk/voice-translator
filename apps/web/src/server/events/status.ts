import 'server-only';
import { getDb } from '../db';

export async function chainStatus(): Promise<'UNVERIFIED' | 'OK' | 'BROKEN'> {
  const state = await getDb().systemState.findUnique({ where: { id: 1 }, select: { chainStatus: true } });
  return state?.chainStatus === 'OK' || state?.chainStatus === 'BROKEN' ? state.chainStatus : 'UNVERIFIED';
}
