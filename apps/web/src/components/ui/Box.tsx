import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';

/** One box of the start page («ينتظر إجراء مني»، «آجال تقترب»، «جديد منذ آخر دخول»). */
export function Box({
  id,
  title,
  count,
  emptyText,
  headingLabel,
  footer,
  children,
}: {
  id: string;
  title: string;
  count: number;
  emptyText: string;
  /** what a screen reader hears for the heading: the title with its count spelled out (I-09) */
  headingLabel: string;
  /** shown whatever the count: what a box cut in pages says of the rest (independent review IR-11) */
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const headingId = `${id}-title`;
  return (
    <section aria-labelledby={headingId} className="card flex flex-col">
      <h2 id={headingId} className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 text-lg">
        <span className="sr-only">{headingLabel}</span>
        <span aria-hidden="true">{title}</span>
        {/* A filled circle when something waits in the box. */}
        <span
          aria-hidden="true"
          className={
            'inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 font-sans text-sm font-semibold tabular-nums ' +
            (count > 0 ? 'bg-ink-800 text-white' : 'bg-ink-100 text-ink-800')
          }
        >
          {count}
        </span>
      </h2>
      <div className="flex-1 px-5 py-4">
        {count === 0 ? <EmptyState text={emptyText} /> : children}
        {footer}
      </div>
    </section>
  );
}
