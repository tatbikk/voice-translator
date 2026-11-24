import { roleLabelKey, type RoleCode } from '@mahkama/core';
import { translator } from '@/i18n/translate';
import type { GateContext } from '@/server/permissions/guard';
import { demoAccounts } from '../server/services';
import { DemoSwitcher } from './DemoSwitcher';

/**
 * The demo tools' bottom bar: visually apart from the platform (its own strip,
 * neutral background, its own landmark), never mixed with the platform's
 * interface. Phase 0 tools: the account switcher and the outbox.
 */
export async function DemoBar({ context }: { context: GateContext }) {
  const t = translator(context.locale);
  const accounts = await demoAccounts();
  const options = accounts.map((a) => ({
    value: a.roleAssignmentId,
    label: a.courtName
      ? t('demo.accountOptionCourt', { role: t(roleLabelKey(a.role as RoleCode, a.courtDegree)), name: a.fullName, court: a.courtName })
      : t('demo.accountOption', { role: t(roleLabelKey(a.role as RoleCode, a.courtDegree)), name: a.fullName }),
  }));
  return (
    <>
      <div aria-hidden="true" className="h-24 no-print" />
      <aside
        aria-label={t('demo.tools')}
        className="no-print fixed inset-x-0 bottom-0 z-30 border-t-2 border-dashed border-line-strong bg-canvas"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-end gap-4 px-4 py-3">
          <p className="text-sm font-semibold text-text-muted">{t('demo.tools')}</p>
          <DemoSwitcher
            label={t('demo.accountSwitcher')}
            chooseLabel={t('demo.chooseAccount')}
            submitLabel={t('demo.switch')}
            errorText={t('errors.NOT_FOUND')}
            options={options}
          />
          <a href="/demo/outbox" className="min-h-11 py-2">
            {t('demo.outbox.open')}
          </a>
        </div>
      </aside>
    </>
  );
}
