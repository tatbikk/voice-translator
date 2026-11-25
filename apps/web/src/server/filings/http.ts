import 'server-only';
import type { UserSubject } from '@mahkama/core';
import type { SessionContext } from '../auth/sessions';
import { fail, notFound, ok } from '../http/responses';
import { draftView, loadDraft, type DraftWithParts } from './drafts';
import type { Outcome } from './service';

// What the filing routes share: the draft the endpoint authorized, read again
// in full for its handler, and the answer of a service outcome.

export interface FilingCaller {
  readonly subject: UserSubject;
  readonly session: SessionContext;
}

/** The caller of an authorized filing route: a selected role is guaranteed by the endpoint. */
export function callerOf(session: SessionContext | null): FilingCaller | null {
  return session?.subject ? { subject: session.subject, session } : null;
}

export async function withDraft(
  draftId: string,
  session: SessionContext | null,
  fn: (draft: DraftWithParts, caller: FilingCaller) => Promise<Response>,
): Promise<Response> {
  const caller = callerOf(session);
  const draft = await loadDraft(draftId);
  if (!caller || !draft) return notFound();
  return fn(draft, caller);
}

export function answer<T>(outcome: Outcome<T>, data?: (value: T) => unknown): Response {
  if (!outcome.ok) return fail(outcome.status, outcome.code, outcome.fields ? { fields: outcome.fields } : {});
  return ok(data ? data(outcome.value) : (outcome.value ?? {}));
}

/** The draft as the wizard shows it, after a change. */
export async function freshView(draftId: string, subject: UserSubject): Promise<Response> {
  const draft = await loadDraft(draftId);
  return draft ? ok(await draftView(draft, subject)) : notFound();
}
