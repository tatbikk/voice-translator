'use client';

import { useId, useState, type ReactNode } from 'react';
import { cx } from '@/components/ui/cx';

/**
 * The top bar's entries. On large screens they stand in the letterhead row; on
 * smaller ones a button named after the menu opens them below it, so that the
 * letterhead keeps one row on a phone.
 */
export function NavDisclosure({ label, buttonLabel, children }: { label: string; buttonLabel: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => { setOpen((value) => !value); }}
        className="ms-auto inline-flex min-h-11 items-center rounded border border-line-strong px-2 text-[0.9375rem] text-text transition-colors hover:bg-ink-100 hover:text-ink-900 lg:hidden"
      >
        {buttonLabel}
      </button>
      <nav
        id={id}
        aria-label={label}
        className={cx(
          open ? 'flex' : 'hidden',
          'w-full flex-col items-stretch gap-0.5 border-t border-line pt-2 pb-1',
          'lg:ms-auto lg:flex lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:border-t-0 lg:p-0',
        )}
      >
        {children}
      </nav>
    </>
  );
}
