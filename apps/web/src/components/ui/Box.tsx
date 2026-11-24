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
    <section aria-labelledby={headingId} className="border border-line bg-paper">
      <h2 id={headingId} className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-3 text-lg">
        <span>{title}</span>
        <span className="font-sans text-base font-normal text-text-muted">{count}</span>
      </h2>
      <div className="px-5 py-3">{count === 0 ? <EmptyState text={emptyText} /> : children}</div>
    </section>
  );
}
