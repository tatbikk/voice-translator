'use client';

import { AlertDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { buttonClass } from './Button';

export interface ConfirmLines {
  readonly title: string;
  /** what follows from the action */
  readonly effectLabel: string;
  readonly effect: string;
  /** who is notified of it */
  readonly notifiedLabel: string;
  readonly notified: string;
  /** the article it rests on */
  readonly basisLabel: string;
  readonly basis: string;
  readonly confirm: string;
  readonly cancel: string;
}

/**
 * The confirmation window every action button opens (rule 1 of the prompt):
 * three lines — what follows, who is notified, the legal basis.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  lines,
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: ConfirmLines;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const row = (label: string, value: string): ReactNode => (
    <div className="grid gap-1 border-b border-line py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="font-semibold text-ink-800">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-ink-950/40" />
        <AlertDialog.Content className="fixed inset-x-4 top-[10vh] z-50 mx-auto max-w-xl border border-line-strong bg-paper p-6 shadow-lg">
          <AlertDialog.Title className="font-naskh text-xl font-bold text-ink-900">{lines.title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <dl className="mt-4">
              {row(lines.effectLabel, lines.effect)}
              {row(lines.notifiedLabel, lines.notified)}
              {row(lines.basisLabel, lines.basis)}
            </dl>
          </AlertDialog.Description>
          <div className="mt-6 flex flex-wrap gap-3">
            <AlertDialog.Action asChild>
              <button
                type="button"
                className={buttonClass('primary')}
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  onConfirm();
                }}
              >
                {lines.confirm}
              </button>
            </AlertDialog.Action>
            <AlertDialog.Cancel asChild>
              <button type="button" className={buttonClass('secondary')} disabled={busy}>
                {lines.cancel}
              </button>
            </AlertDialog.Cancel>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
