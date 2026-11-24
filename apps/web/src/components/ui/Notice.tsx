import type { ReactNode } from 'react';
import { cx } from './cx';

type Tone = 'info' | 'warning' | 'success' | 'error';

const TONES: Record<Tone, string> = {
  info: 'border-ink-600 bg-ink-50',
  warning: 'border-approaching bg-approaching-bg',
  success: 'border-success bg-paper',
  error: 'border-elapsed bg-elapsed-bg',
};

/** A message in a full sentence; the tone is carried by the border and the role, not by colour alone. */
export function Notice({ tone = 'info', children, live = false }: { tone?: Tone; children: ReactNode; live?: boolean }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : live ? 'status' : undefined}
      className={cx('rounded-e-md border-s-4 px-4 py-3 text-base leading-relaxed', TONES[tone])}
    >
      {children}
    </div>
  );
}
