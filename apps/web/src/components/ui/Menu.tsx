'use client';

import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';

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
        className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-transparent px-3 hover:border-line-strong"
      >
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-56 border border-line-strong bg-paper py-1 shadow-md"
        >
          {header ? <div className="border-b border-line px-4 py-2 text-sm text-text-muted">{header}</div> : null}
          {entries.map((entry) =>
            entry.href ? (
              <DropdownMenu.Item key={entry.key} asChild>
                <a href={entry.href} className="block px-4 py-2 text-text no-underline outline-none data-[highlighted]:bg-ink-50">
                  {entry.label}
                </a>
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item
                key={entry.key}
                onSelect={entry.onSelect}
                aria-current={entry.current ? 'true' : undefined}
                className="cursor-pointer px-4 py-2 outline-none data-[highlighted]:bg-ink-50 aria-[current=true]:font-semibold"
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
