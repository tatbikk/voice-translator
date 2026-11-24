import type { ReactNode } from 'react';
import { translator } from '@/i18n/translate';
import type { GateContext } from '@/server/permissions/guard';
import { SkipLink } from '@/components/ui/SkipLink';
import { DemoSlot } from './demo-slot';
import { TopBar } from './TopBar';

/** Frame of every page past the visitor gate: top bar, main landmark, footer, demo bar. */
export function Frame({ context, children, width = 'normal' }: { context: GateContext; children: ReactNode; width?: 'normal' | 'narrow' }) {
  const t = translator(context.locale);
  return (
    <>
      <SkipLink label={t('common.skipToContent')} />
      <TopBar context={context} />
      <main id="main" tabIndex={-1} className={width === 'narrow' ? 'mx-auto max-w-xl px-4 py-10' : 'mx-auto max-w-6xl px-4 py-10'}>
        {children}
      </main>
      <footer className="mt-16 border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-6 text-sm text-text-muted">{t('shell.footer')}</p>
      </footer>
      <DemoSlot context={context} />
    </>
  );
}
