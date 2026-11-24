import { SPACES } from '@mahkama/core';
import { translator } from '@/i18n/translate';
import { ButtonLink } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { Frame } from '@/components/shell/Frames';
import { requireGate } from '@/server/permissions/guard';
import type { Metadata } from 'next';
import { screenMetadata } from '@/server/page-metadata';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.home');

// «صفحة الاستقبال»: presents the platform and its spaces. In the demo
// environment it states once, formally, that this is a proposed platform and
// not an existing official portal.
export default async function HomePage() {
  const context = await requireGate('home');
  const t = translator(context.locale);
  return (
    <Frame context={context}>
      <h1 className="text-3xl">{t('common.platformName')}</h1>
      <p className="mt-4 max-w-3xl text-lg leading-loose">{t('home.intro')}</p>
      {context.mode === 'demo' ? (
        <div className="mt-6 max-w-3xl">
          <Notice>{t('home.demoNotice')}</Notice>
        </div>
      ) : null}
      <div className="mt-10 grid gap-8 md:grid-cols-[2fr_1fr]">
        <section aria-labelledby="spaces-title">
          <h2 id="spaces-title" className="mb-4 text-xl">
            {t('home.spacesTitle')}
          </h2>
          <ul className="divide-y divide-line border-y border-line">
            {SPACES.map((space) => (
              <li key={space} className="py-3">
                <p className="font-semibold text-ink-800">{t(`spaces.${space}`)}</p>
                <p className="text-text-muted">{t(`spaces.${space}.description`)}</p>
              </li>
            ))}
          </ul>
        </section>
        <div className="space-y-8">
          <section aria-labelledby="services-title">
            <h2 id="services-title" className="mb-4 text-xl">
              {t('home.servicesTitle')}
            </h2>
            <p className="flex flex-col gap-3">
              <ButtonLink href="/track">{t('screens.track')}</ButtonLink>
              <ButtonLink href="/hearings">{t('screens.hearings')}</ButtonLink>
            </p>
          </section>
          <section aria-labelledby="login-title">
            <h2 id="login-title" className="mb-4 text-xl">
              {t('home.loginTitle')}
            </h2>
            <p className="mb-4 text-text-muted">{t('home.loginText')}</p>
            <ButtonLink href={context.session?.subject ? '/dashboard' : '/login'} variant="primary">
              {context.session?.subject ? t('screens.dashboard') : t('screens.login')}
            </ButtonLink>
          </section>
        </div>
      </div>
    </Frame>
  );
}
