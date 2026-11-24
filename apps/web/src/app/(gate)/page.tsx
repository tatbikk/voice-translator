import { SPACES } from '@mahkama/core';
import { translator } from '@/i18n/translate';
import { ButtonLink } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { ServiceCard } from '@/components/ui/ServiceCard';
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
  const loggedIn = Boolean(context.session?.subject);
  return (
    <Frame context={context} width="full">
      {/* The opening sheet continues the letterhead: the name, what the platform is, and, in the demo, what it is not. */}
      <section aria-labelledby="home-title" className="border-b border-line bg-paper">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
          <h1 id="home-title" className="text-[2.25rem] leading-[1.35] sm:text-5xl sm:leading-[1.3]">
            {t('common.platformName')}
          </h1>
          <div aria-hidden="true" className="mt-5 h-0.5 w-16 bg-ink-800" />
          <p className="mt-6 max-w-3xl text-lg leading-[1.95] sm:text-xl sm:leading-[1.9]">{t('home.intro')}</p>
          {context.mode === 'demo' ? (
            <div className="mt-8 max-w-3xl">
              <Notice>{t('home.demoNotice')}</Notice>
            </div>
          ) : null}
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 pt-12 pb-4 sm:pt-14">
        <div className="grid gap-x-6 gap-y-10 lg:grid-cols-3">
          <section aria-labelledby="services-title" className="flex flex-col lg:col-span-2">
            <h2 id="services-title" className="text-[1.375rem] sm:text-2xl">
              {t('home.servicesTitle')}
            </h2>
            <ul className="mt-5 grid flex-1 gap-4 sm:grid-cols-2">
              <li>
                <ServiceCard href="/track" title={t('screens.track')} text={t('home.services.track')} />
              </li>
              <li>
                <ServiceCard href="/hearings" title={t('screens.hearings')} text={t('home.services.hearings')} />
              </li>
            </ul>
          </section>
          <section aria-labelledby="login-title" className="flex flex-col">
            <h2 id="login-title" className="text-[1.375rem] sm:text-2xl">
              {t('home.loginTitle')}
            </h2>
            <div className="card mt-5 flex flex-1 flex-col p-6">
              <p className="text-[0.9375rem] leading-relaxed text-text-muted">{t('home.loginText')}</p>
              <div className="mt-auto pt-5">
                <ButtonLink href={loggedIn ? '/dashboard' : '/login'} variant="primary" className="w-full">
                  {loggedIn ? t('screens.dashboard') : t('screens.login')}
                </ButtonLink>
              </div>
            </div>
          </section>
        </div>

        <section aria-labelledby="spaces-title" className="mt-14">
          <h2 id="spaces-title" className="text-[1.375rem] sm:text-2xl">
            {t('home.spacesTitle')}
          </h2>
          <ul className="mt-5 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
            {SPACES.map((space) => (
              <li key={space} className="border-t border-line py-5">
                <h3 className="text-lg">{t(`spaces.${space}`)}</h3>
                <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-text-muted">{t(`spaces.${space}.description`)}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Frame>
  );
}
