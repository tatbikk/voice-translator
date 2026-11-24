'use client';

import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { NAV_ITEM } from '@/components/shell/nav-style';

export interface MenuEntry {
  readonly key: string;
  readonly label: string;
  readonly onSelect?: () => void;
  readonly href?: string;
  readonly current?: boolean;
}

// The keyboard focus keeps the platform's focus ring, drawn inside the item.
const ITEM =
  'block px-4 py-2.5 text-text no-underline data-[highlighted]:bg-ink-100 data-[highlighted]:text-ink-900 ' +
  'focus-visible:[outline-offset:-3px]';

/** A small menu for the top bar (account, language, reading ease). */
export function Menu({
  trigger,
  label,
  entries,
  header,
  dir,
  labelInTrigger = false,
}: {
  trigger: ReactNode;
  label: string;
  entries: readonly MenuEntry[];
  header?: ReactNode;
  dir: 'rtl' | 'ltr';
  /** the trigger already carries the label (visually hidden), so that its name contains its visible text */
  labelInTrigger?: boolean;
}) {
  return (
    <DropdownMenu.Root dir={dir}>
      <DropdownMenu.Trigger aria-label={labelInTrigger ? undefined : label} className={NAV_ITEM}>
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-56 rounded-md border border-line bg-paper py-1 shadow-lg"
        >
          {header ? <div className="mb-1 border-b border-line px-4 py-2.5 text-sm text-text-muted">{header}</div> : null}
          {entries.map((entry) =>
            entry.href ? (
              <DropdownMenu.Item key={entry.key} asChild>
                <a href={entry.href} className={ITEM}>
                  {entry.label}
                </a>
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item
                key={entry.key}
                onSelect={entry.onSelect}
                aria-current={entry.current ? 'true' : undefined}
                className={`${ITEM} cursor-pointer aria-[current=true]:font-semibold aria-[current=true]:text-ink-900`}
              >
                {entry.label}
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
