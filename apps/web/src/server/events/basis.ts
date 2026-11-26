import 'server-only';
import { ACTIONS, moroccoDay, resolveLegalBasis, type LegalBasis, type Resource } from '@mahkama/core';

/**
 * «بأي سند» (rule 4 of the prompt): the legal basis of the action that writes an
 * event, as the core's action table resolves it on the day of the act. Every
 * event written for a procedural act, the filing, the registration and the
 * payment carries it (independent review IR-12, decision 74).
 */
export function basisOf(code: string, at: Date, resource?: Resource): LegalBasis {
  const rule = ACTIONS[code];
  if (!rule) throw new Error(`basis: no action ${code}`);
  return resolveLegalBasis(rule, resource, moroccoDay(at));
}
