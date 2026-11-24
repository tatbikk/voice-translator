import type { ReactNode } from 'react';
import { TABLE } from './table-style';

/**
 * The card around a table. It scrolls sideways when the table is wider than the
 * screen, and takes the keyboard focus so that it can be scrolled without a mouse.
 */
export function TableFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={TABLE.wrap} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
