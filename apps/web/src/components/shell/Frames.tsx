import type { ReactNode } from 'react';
import { translator } from '@/i18n/translate';
import type { GateContext } from '@/server/permissions/guard';
import { SkipLink } from '@/components/ui/SkipLink';
import { TopBar } from './TopBar';

/**
 * Frame of every page past the visitor gate: top bar, main landmark, footer. The
 * demo bar is in the layouts. A narrow page (login and the like) is a white
 * sheet in the middle of the canvas; a full page lays out its own bands.
 */
export function Frame({
  context,
  children,
  width = 'normal',
}: {
  context: GateContext;
  children: ReactNode;
  width?: 'normal' | 'narrow' | 'full';
}) {
  const t = translator(context.locale);
  return (
    <>
      <SkipLink label={t('common.skipToContent')} />
      <TopBar context={context} />
      {width === 'full' ? (
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      ) : width === 'narrow' ? (
        <main id="main" tabIndex={-1} className="mx-auto max-w-xl px-4 py-10 sm:py-14">
          <div className="card px-5 py-6 sm:px-8 sm:py-8">{children}</div>
        </main>
      ) : (
        <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-10 sm:py-12">
          {children}
        </main>
      )}
      <footer className="mt-16 border-t border-line bg-paper">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <p className="font-naskh text-lg font-bold text-ink-900">{t('common.platformName')}</p>
          <p className="mt-1 max-w-3xl text-sm text-text-muted">{t('shell.footer')}</p>
        </div>
      </footer>
    </>
  );
}
