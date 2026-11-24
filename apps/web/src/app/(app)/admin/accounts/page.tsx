import { ACTIONS, authorize, resolveLegalBasis, roleLabelKey, type Resource } from '@mahkama/core';
import { dictionary } from '@/i18n/dictionary';
import { translator } from '@/i18n/translate';
import { ReissueActivationButton } from '@/components/forms/ReissueActivationButton';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Frame } from '@/components/shell/Frames';
import { legalBasisText } from '@/components/shell/legal-basis-text';
import { listAccounts } from '@/server/accounts/service';
import { requirePage } from '@/server/permissions/guard';
import type { Metadata } from 'next';
import { screenMetadata } from '@/server/page-metadata';
import { TABLE } from '@/components/ui/table-style';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.admin-accounts');

// «الحسابات» (system administrator).
export default async function AccountsPage() {
  const context = await requirePage('admin.accounts', 'admin.accounts.list');
  const t = translator(context.locale);
  const accounts = await listAccounts();
  const rule = ACTIONS['admin.accounts.reissue-activation'];
  const messages = dictionary(context.locale, ['errors.']);
  return (
    <Frame context={context}>
      <PageHeader title={t('screens.admin-accounts')} intro={t('admin.accounts.intro')}>
        <p className="mt-4">
          <ButtonLink href="/admin/accounts/new" variant="primary">
            {t('admin.accounts.newLink')}
          </ButtonLink>
        </p>
      </PageHeader>
      {accounts.length === 0 ? (
        <EmptyState text={t('admin.accounts.empty')} />
      ) : (
        <div className={TABLE.wrap}>
          <table className={TABLE.table}>
            <caption className="sr-only">{t('screens.admin-accounts')}</caption>
            <thead>
              <tr className={TABLE.headRow}>
                <th scope="col" className={TABLE.th}>{t('admin.accounts.columns.name')}</th>
                <th scope="col" className={TABLE.th}>{t('admin.accounts.columns.email')}</th>
                <th scope="col" className={TABLE.th}>{t('admin.accounts.columns.roles')}</th>
                <th scope="col" className={TABLE.th}>{t('admin.accounts.columns.status')}</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const resource: Resource = {
                  kind: 'account',
                  userId: a.id,
                  isDemo: a.isDemo,
                  activated: a.activated,
                  disabled: a.disabled,
                  role: a.roles[0]?.role ?? null,
                };
                const basis = legalBasisText(t, resolveLegalBasis(rule, resource));
                // The button exists only when the core allows the action on this account.
                const canReissue = authorize(context.subject, rule.code, resource, {
                  mode: context.mode,
                  demoToolsEnabled: context.demoToolsEnabled,
                }).allowed;
                return (
                  <tr key={a.id} className={TABLE.row}>
                    <td className={TABLE.td}>
                      {a.fullName}
                      {a.isDemo ? <span className="ms-2 text-sm text-text-muted">{t('admin.accounts.demo')}</span> : null}
                    </td>
                    <td className={TABLE.td}>
                      <bdi dir="ltr">{a.email}</bdi>
                    </td>
                    <td className={TABLE.td}>
                      <ul>
                        {a.roles.map((r, i) => (
                          <li key={`${r.role}-${String(i)}`}>
                            {r.courtName
                              ? t('admin.accounts.roleWithCourt', { role: t(roleLabelKey(r.role, r.courtDegree)), court: r.courtName })
                              : t(roleLabelKey(r.role, r.courtDegree))}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className={TABLE.td}>
                      {a.disabled
                        ? t('admin.accounts.status.disabled')
                        : a.activated
                          ? t('admin.accounts.status.active')
                          : t('admin.accounts.status.pending')}
                      {canReissue ? (
                        <div className="mt-2">
                          <ReissueActivationButton
                            userId={a.id}
                            label={t(rule.labelKey)}
                            doneText={t('admin.accounts.reissued')}
                            messages={messages}
                            lines={{
                              title: t('actions.confirm.title'),
                              effectLabel: t('actions.confirm.effect'),
                              effect: t(rule.effectKey),
                              notifiedLabel: t('actions.confirm.notified'),
                              notified: t(rule.notifiedKey),
                              basisLabel: t('actions.confirm.legalBasis'),
                              basis,
                              confirm: t('common.confirm'),
                              cancel: t('common.cancel'),
                            }}
                          />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Frame>
  );
}
