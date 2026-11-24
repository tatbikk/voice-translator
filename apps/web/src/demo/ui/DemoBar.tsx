import { authorize, roleLabelKey, type RoleCode } from '@mahkama/core';
import { clock } from '@/server/clock';
import { translator } from '@/i18n/translate';
import type { GateContext } from '@/server/permissions/guard';
import { demoAccounts } from '../server/services';
import { DemoSwitcher } from './DemoSwitcher';

/**
 * The demo tools' bottom bar: visually apart from the platform (its own strip,
 * neutral background, its own landmark), never mixed with the platform's
 * interface. Phase 0 tools: the account switcher and the outbox.
 *
 * Fixed to the bottom of the window on large screens only. On a phone it wraps
 * to several rows and would cover a third of the screen and the end of every
 * page, so it closes the page there instead.
 */
export async function DemoBar({ context }: { context: GateContext }) {
  const t = translator(context.locale);
  // The list of demo accounts is shown only where the core grants it (review A-04).
  const decision = authorize(context.subject, 'demo.accounts.list', undefined, {
    mode: context.mode,
    demoToolsEnabled: context.demoToolsEnabled,
    now: clock.now(),
  });
  if (!decision.allowed) return null;
  const accounts = await demoAccounts();
  const options = accounts.map((a) => ({
    value: a.roleAssignmentId,
    label: a.courtName
      ? t('demo.accountOptionCourt', { role: t(roleLabelKey(a.role as RoleCode, a.courtDegree)), name: a.fullName, court: a.courtName })
      : t('demo.accountOption', { role: t(roleLabelKey(a.role as RoleCode, a.courtDegree)), name: a.fullName }),
  }));
  return (
    <>
      <div aria-hidden="true" className="no-print hidden h-24 lg:block" />
      <section
        aria-label={t('demo.tools')}
        className="no-print border-t-2 border-dashed border-line-strong bg-tool lg:fixed lg:inset-x-0 lg:bottom-0 lg:z-30"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-end gap-4 px-4 py-3">
          <p className="text-sm font-semibold text-text-muted">{t('demo.tools')}</p>
          <DemoSwitcher
            label={t('demo.accountSwitcher')}
            chooseLabel={t('demo.chooseAccount')}
            submitLabel={t('demo.switch')}
            errorText={t('errors.NOT_FOUND')}
            options={options}
            current={context.session?.roleAssignment?.id ?? null}
          />
          <a href="/demo/outbox" className="min-h-11 py-2">
            {t('demo.outbox.open')}
          </a>
        </div>
      </section>
    </>
  );
}
