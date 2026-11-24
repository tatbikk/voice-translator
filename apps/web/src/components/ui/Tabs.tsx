'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

/**
 * Accessible tabs (WAI-ARIA tabs pattern), written here rather than taken from a
 * library because the library version emits inline style attributes that the
 * content security policy refuses. In right-to-left text the arrow keys follow
 * the reading direction.
 */
export function Tabs({ items, label }: { items: readonly TabItem[]; label: string }) {
  const [active, setActive] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const focus = (index: number) => {
    const next = (index + items.length) % items.length;
    setActive(next);
    refs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === forward) focus(index + 1);
    else if (event.key === backward) focus(index - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(items.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div>
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-line">
        {items.map((item, index) => (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            id={`${base}-tab-${item.id}`}
            role="tab"
            type="button"
            aria-selected={index === active}
            aria-controls={`${base}-panel-${item.id}`}
            tabIndex={index === active ? 0 : -1}
            onClick={() => { setActive(index); }}
            onKeyDown={(event) => { onKeyDown(event, index); }}
            className={cx(
              'min-h-11 border-b-2 px-4 py-2',
              index === active ? 'border-ink-800 font-semibold text-ink-900' : 'border-transparent text-text-muted',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item, index) => (
        <div
          key={item.id}
          id={`${base}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${item.id}`}
          hidden={index !== active}
          tabIndex={0}
          className="py-5"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
