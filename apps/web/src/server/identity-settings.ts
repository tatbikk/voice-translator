import 'server-only';
import { getEnv } from './config/env';
import { getDb } from './db';

// Institutional identity (rule 10 of the prompt): the official logo, header
// lines and operator name are settings entered by the administration when it
// adopts the platform, shown in production mode only. In the demo environment
// the logo slot always holds the neutral frame «موضع الشعار الرسمي».

export interface InstitutionalIdentityView {
  /** null: show the neutral frame */
  readonly logoFileId: string | null;
  readonly operatorName: string | null;
  readonly headerLines: readonly string[];
}

export async function institutionalIdentity(): Promise<InstitutionalIdentityView> {
  if (getEnv().mode === 'demo') return { logoFileId: null, operatorName: null, headerLines: [] };
  const row = await getDb().institutionalIdentity.findUnique({ where: { id: 1 } });
  const lines = Array.isArray(row?.headerLines) ? row.headerLines.filter((l): l is string => typeof l === 'string') : [];
  return { logoFileId: row?.logoFileId ?? null, operatorName: row?.operatorName ?? null, headerLines: lines };
}
