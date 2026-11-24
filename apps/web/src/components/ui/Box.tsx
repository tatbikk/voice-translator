import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';

/** One box of the start page («ينتظر إجراء مني»، «آجال تقترب»، «جديد منذ آخر دخول»). */
export function Box({
  id,
  title,
  count,
  emptyText,
  children,
}: {
  id: string;
  title: string;
  count: number;
  emptyText: string;
  children?: ReactNode;
}) {
  const headingId = `${id}-title`;
  return (
    <section aria-labelledby={headingId} className="card flex flex-col">
      <h2 id={headingId} className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 text-lg">
        <span>{title}</span>
        {/* A filled circle when something waits in the box. */}
        <span
          className={
            'inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 font-sans text-sm font-semibold tabular-nums ' +
            (count > 0 ? 'bg-ink-800 text-white' : 'bg-ink-50 text-ink-800')
          }
        >
          {count}
        </span>
      </h2>
      <div className="flex-1 px-5 py-4">{count === 0 ? <EmptyState text={emptyText} /> : children}</div>
    </section>
  );
}
