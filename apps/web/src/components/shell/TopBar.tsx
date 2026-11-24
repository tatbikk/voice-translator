import { authorize, roleLabelKey } from '@mahkama/core';
import { directionOf } from '@/i18n/locales';
import { isTranslated, translator } from '@/i18n/translate';
import { unreadCount } from '@/server/notifications/service';
import type { GateContext } from '@/server/permissions/guard';
import { AccountMenu } from './AccountMenu';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LogoSlot } from './LogoSlot';
import { NotificationsBell } from './NotificationsBell';
import { ReadingEaseControl } from './ReadingEaseControl';
import { COOKIES, readCookie } from '@/server/http/cookies';
import { NAV_ITEM } from './nav-style';

function readingPreferences(req: Request): { size: number; contrast: number } {
  const match = /^s([0-2])c([01])$/.exec(readCookie(req, COOKIES.reading) ?? '');
  return { size: match ? Number(match[1]) : 0, contrast: match ? Number(match[2]) : 0 };
}

/**
 * The top bar shared by every space (study, «العناصر المشتركة»): logo slot and
 * wordmark, the quiet demo indicator, notifications, language, reading ease and
 * the personal account. The search box and the deadlines-register entry appear
 * in the phases that build what they open.
 */
export async function TopBar({ context }: { context: GateContext }) {
  const t = translator(context.locale);
  const dir = directionOf(context.locale);
  const subject = context.session?.subject ?? null;
  const unread = subject ? await unreadCount(subject.userId) : 0;
  const reading = readingPreferences(context.req);
  const canSwitchRole =
    subject !== null &&
    authorize(subject, 'account.switch-role', undefined, { mode: context.mode, demoToolsEnabled: context.demoToolsEnabled }).allowed;
  const roleLabel = subject ? t(roleLabelKey(subject.role, context.session?.courtDegree)) : '';
  const pathname = context.path.split(/[?#]/)[0];
  const current = (href: string) => (pathname === href ? ('page' as const) : undefined);

  return (
    <header className="bg-paper">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 pt-3 pb-1.5 lg:py-4">
        <a href={subject ? '/dashboard' : '/'} className="flex items-center gap-3 text-ink-900 no-underline">
          {/* The neutral frame until the institutional identity screen serves the logo (Phase 9; review A-18). */}
          <LogoSlot label={t('shell.logoSlot')} logoUrl={null} />
          <span className="font-naskh text-xl leading-tight font-bold sm:text-2xl">{t('common.platformName')}</span>
        </a>
        {context.mode === 'demo' ? (
          <a
            href="/environment"
            className="rounded-full border border-line-strong px-2.5 py-0.5 text-xs font-medium text-text-muted no-underline transition-colors hover:border-ink-700 hover:text-ink-800"
          >
            {t('shell.demoIndicator')}
          </a>
        ) : null}
        {/* Below large screens the entries take a row of their own under the wordmark. */}
        <nav
          aria-label={t('shell.nav.main')}
          className="flex w-full flex-wrap items-center gap-0.5 border-t border-line pt-1.5 lg:ms-auto lg:w-auto lg:border-t-0 lg:pt-0"
        >
          {subject ? (
            <>
              <a href="/dashboard" className={NAV_ITEM} aria-current={current('/dashboard')}>
                {t('shell.nav.dashboard')}
              </a>
              <NotificationsBell
                label={t('shell.notifications.label')}
                initialUnread={unread}
                unreadTemplate={t('shell.notifications.unread')}
              />
            </>
          ) : (
            <>
              <a href="/track" className={NAV_ITEM} aria-current={current('/track')}>
                {t('shell.nav.track')}
              </a>
              <a href="/hearings" className={NAV_ITEM} aria-current={current('/hearings')}>
                {t('shell.nav.hearings')}
              </a>
            </>
          )}
          <LanguageSwitcher
            dir={dir}
            label={t('shell.language.label')}
            current={context.locale}
            options={[
              { code: 'ar', label: t('shell.language.ar') },
              { code: 'fr', label: t('shell.language.fr') },
              { code: 'zgh', label: t('shell.language.zgh') },
            ]}
          />
          <ReadingEaseControl
            dir={dir}
            size={reading.size}
            contrast={reading.contrast}
            labels={{
              label: t('shell.reading.label'),
              size0: t('shell.reading.size0'),
              size1: t('shell.reading.size1'),
              size2: t('shell.reading.size2'),
              contrastOn: t('shell.reading.contrastOn'),
              contrastOff: t('shell.reading.contrastOff'),
            }}
          />
          {subject && context.session ? (
            <AccountMenu
              dir={dir}
              label={t('shell.account.menu')}
              header={t('shell.account.signedInAs', { name: context.session.user.fullName, role: roleLabel })}
              accountLabel={t('shell.nav.account')}
              switchRoleLabel={t('shell.account.switchRole')}
              logoutLabel={t('shell.account.logout')}
              canSwitchRole={canSwitchRole}
            />
          ) : (
            <a href="/login" className={NAV_ITEM} aria-current={current('/login')}>
              {t('shell.nav.login')}
            </a>
          )}
        </nav>
      </div>
      <div aria-hidden="true" className="rule-letterhead" />
      {context.locale !== 'ar' && isTranslated(context.locale, 'shell.partialTranslation') ? (
        <p className="border-b border-line bg-ink-50 px-4 py-2 text-center text-sm">{t('shell.partialTranslation')}</p>
      ) : null}
    </header>
  );
}
