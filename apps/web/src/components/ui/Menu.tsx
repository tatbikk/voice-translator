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

/** A small menu for the top bar (account, language, reading ease). */
export function Menu({
  trigger,
  label,
  entries,
  header,
  dir,
}: {
  trigger: ReactNode;
  label: string;
  entries: readonly MenuEntry[];
  header?: ReactNode;
  dir: 'rtl' | 'ltr';
}) {
  return (
    <DropdownMenu.Root dir={dir}>
      <DropdownMenu.Trigger
        aria-label={label}
        className={NAV_ITEM}
      >
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
                <a href={entry.href} className="block px-4 py-2.5 text-text no-underline outline-none data-[highlighted]:bg-ink-50 data-[highlighted]:text-ink-900">
                  {entry.label}
                </a>
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item
                key={entry.key}
                onSelect={entry.onSelect}
                aria-current={entry.current ? 'true' : undefined}
                className="cursor-pointer px-4 py-2.5 outline-none data-[highlighted]:bg-ink-50 data-[highlighted]:text-ink-900 aria-[current=true]:font-semibold aria-[current=true]:text-ink-900"
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
