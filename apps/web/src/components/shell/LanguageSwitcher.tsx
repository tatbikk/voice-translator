'use client';

import { Menu } from '@/components/ui/Menu';
import { apiPost } from '@/components/client/api';

export function LanguageSwitcher({
  label,
  current,
  options,
  dir,
}: {
  label: string;
  current: string;
  options: readonly { code: 'ar' | 'fr' | 'zgh'; label: string }[];
  dir: 'rtl' | 'ltr';
}) {
  return (
    <Menu
      dir={dir}
      label={label}
      trigger={<span>{options.find((o) => o.code === current)?.label ?? label}</span>}
      entries={options.map((option) => ({
        key: option.code,
        label: option.label,
        current: option.code === current,
        onSelect: () => {
          void apiPost('/api/v1/preferences', { locale: option.code }).then(() => { window.location.reload(); });
        },
      }))}
    />
  );
}
