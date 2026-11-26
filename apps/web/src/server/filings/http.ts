import 'server-only';
import type { UserSubject } from '@mahkama/core';
import type { SessionContext } from '../auth/sessions';
import { fail, notFound, ok } from '../http/responses';
import { draftView, loadDraft, type DraftWithParts } from './drafts';
import type { Failure, Outcome } from './service';

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

/** The answer to a refused operation, with its fields or the delay after which to try again. */
export function refusal(failure: Failure): Response {
  return fail(failure.status, failure.code, {
    ...(failure.fields ? { fields: failure.fields } : {}),
    ...(failure.retryAfterSeconds !== undefined ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
  });
}

export function answer<T>(outcome: Outcome<T>, data?: (value: T) => unknown): Response {
  if (!outcome.ok) return refusal(outcome);
  return ok(data ? data(outcome.value) : (outcome.value ?? {}));
}

/** The draft as the wizard shows it, after a change. */
export async function freshView(draftId: string, subject: UserSubject): Promise<Response> {
  const draft = await loadDraft(draftId);
  return draft ? ok(await draftView(draft, subject)) : notFound();
}
