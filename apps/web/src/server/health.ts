import 'server-only';
import { getDb } from './db';

export async function checkDatabase(): Promise<boolean> {
  try {
    await getDb().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
