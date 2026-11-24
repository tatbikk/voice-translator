'use client';

import { Menu } from '@/components/ui/Menu';
import { apiPost } from '@/components/client/api';

/** «أداة تيسير القراءة»: text size (three steps) and high contrast. */
export function ReadingEaseControl({
  labels,
  size,
  contrast,
  dir,
}: {
  labels: { label: string; size0: string; size1: string; size2: string; contrastOn: string; contrastOff: string };
  size: number;
  contrast: number;
  dir: 'rtl' | 'ltr';
}) {
  const apply = (nextSize: number, nextContrast: number) => {
    document.documentElement.dataset.textSize = String(nextSize);
    document.documentElement.dataset.contrast = String(nextContrast);
    void apiPost('/api/v1/preferences', { readingSize: nextSize, readingContrast: nextContrast });
  };
  return (
    <Menu
      dir={dir}
      label={labels.label}
      trigger={<span>{labels.label}</span>}
      entries={[
        { key: 's0', label: labels.size0, current: size === 0, onSelect: () => { apply(0, contrast); } },
        { key: 's1', label: labels.size1, current: size === 1, onSelect: () => { apply(1, contrast); } },
        { key: 's2', label: labels.size2, current: size === 2, onSelect: () => { apply(2, contrast); } },
        {
          key: 'contrast',
          label: contrast === 1 ? labels.contrastOff : labels.contrastOn,
          onSelect: () => { apply(size, contrast === 1 ? 0 : 1); },
        },
      ]}
    />
  );
}
