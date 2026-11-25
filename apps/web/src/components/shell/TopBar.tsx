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
import { NavDisclosure } from './NavDisclosure';

const SPACE_LINKS = [
  { href: '/cases', action: 'cases.list', labelKey: 'shell.nav.cases' },
  { href: '/filings', action: 'filing.drafts.list', labelKey: 'shell.nav.filings' },
  { href: '/registry', action: 'registry.incoming.list', labelKey: 'shell.nav.registry' },
  { href: '/cashier', action: 'cashier.ledger.view', labelKey: 'shell.nav.cashier' },
] as const;

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
  const authContext = { mode: context.mode, demoToolsEnabled: context.demoToolsEnabled };
  // The entries of the user's space, each shown only when the core grants its page.
  const spaceLinks = subject
    ? SPACE_LINKS.filter((l) => authorize(subject, l.action, undefined, authContext).allowed)
    : [];
  const pathname = context.path.split(/[?#]/)[0];
  const current = (href: string) => (pathname === href ? ('page' as const) : undefined);

  return (
    <header className="bg-paper">
      {/* On a phone the letterhead holds one row from 360 pixels up: tighter gaps, a smaller wordmark and indicator. */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3 sm:gap-x-4 lg:gap-x-5 lg:py-4">
        <a href={subject ? '/dashboard' : '/'} className="flex items-center gap-2.5 text-ink-900 no-underline sm:gap-3">
          {/* The neutral frame until the institutional identity screen serves the logo (Phase 9; review A-18).
              Inside the link its placeholder text is not read: the link is named by the wordmark. */}
          <LogoSlot label={t('shell.logoSlot')} logoUrl={null} decorative />
          <span className="font-naskh text-[1.0625rem] leading-tight font-bold whitespace-nowrap sm:text-2xl">{t('common.platformName')}</span>
        </a>
        {context.mode === 'demo' ? (
          <a
            href="/environment"
            className="rounded-full border border-line-strong px-1.5 py-0.5 text-[0.6875rem] font-medium whitespace-nowrap text-text-muted no-underline transition-colors hover:border-ink-700 hover:text-ink-800 sm:px-2.5 sm:text-xs"
          >
            {t('shell.demoIndicator')}
          </a>
        ) : null}
        <NavDisclosure label={t('shell.nav.main')} buttonLabel={t('shell.nav.menu')}>
          {subject ? (
            <>
              <a href="/dashboard" className={NAV_ITEM} aria-current={current('/dashboard')}>
                {t('shell.nav.dashboard')}
              </a>
              {spaceLinks.map((l) => (
                <a key={l.href} href={l.href} className={NAV_ITEM} aria-current={current(l.href)}>
                  {t(l.labelKey)}
                </a>
              ))}
              <NotificationsBell
                label={t('shell.notifications.label')}
                initialUnread={unread}
                unreadTemplate={t('shell.notifications.unread')}
                current={current('/notifications')}
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
        </NavDisclosure>
      </div>
      <div aria-hidden="true" className="rule-letterhead" />
      {context.locale !== 'ar' && isTranslated(context.locale, 'shell.partialTranslation') ? (
        <p className="border-b border-line bg-ink-50 px-4 py-2 text-center text-sm">{t('shell.partialTranslation')}</p>
      ) : null}
    </header>
  );
}
