'use client';

import type { ReactNode, RefObject } from 'react';
import type { Dict, Params } from '@/components/client/messages';
import type { DraftView } from '@/server/filings/drafts';

// What the six screens of the filing share: their props, their frame and the
// labelled controls (a label tied to its control, a hint read with it).

export type ApiOutcome = { ok: true; data?: unknown } | { ok: false; error: { messageKey: string } };

export interface StepProps {
  readonly view: DraftView;
  readonly dict: Dict;
  readonly t: (key: string, params?: Params) => string;
  readonly busy: boolean;
  /** a change of the draft's own fields (POST /api/v1/filings/:draftId) */
  readonly update: (body: Record<string, unknown>) => Promise<boolean>;
  /** any other change, followed by a refresh of the draft */
  readonly run: (work: () => Promise<ApiOutcome>, savedText?: string) => Promise<boolean>;
  readonly refresh: () => Promise<DraftView | null>;
  /** /api/v1/filings/:draftId */
  readonly base: string;
}

export const CONTROL =
  'block w-full min-h-11 rounded border border-line-strong bg-paper px-3 py-2 text-base text-text transition-colors ' +
  'hover:border-ink-700 focus:border-ink-800 disabled:bg-ink-50 disabled:text-text-muted';

export function StepFrame({ headingRef, title, region, children }: { headingRef: RefObject<HTMLHeadingElement | null>; title: string; region: boolean; children: ReactNode }) {
  // Only the fee screen is a named region (the e2e and a screen reader find the
  // amount there); a screen named by its heading would also be found as a field.
  return (
    <section aria-labelledby={region ? 'step-title' : undefined} className="card px-5 py-6 sm:px-7">
      <h2 id="step-title" ref={headingRef} tabIndex={-1} className="mb-4 text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A label above its control; the control carries the same id. */
export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <label htmlFor={id} className="mb-1.5 block font-medium text-ink-900">
        {label}
      </label>
      {hint ? <p className="mb-2 text-sm text-text-muted">{hint}</p> : null}
      {children}
    </div>
  );
}

export const LabeledInput = Field;

export function Choice({ name, checked, onChange, label }: { name: string; checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="size-5" />
      <span>{label}</span>
    </label>
  );
}

export function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => { onChange(e.target.checked); }} className="size-5" />
      <span>{label}</span>
    </label>
  );
}
