import { ACTIONS, ROLE_CODES, ROLES, SECURITY_POLICY, resolveLegalBasis, roleLabelKey } from '@mahkama/core';
import { dictionary } from '@/i18n/dictionary';
import { translator } from '@/i18n/translate';
import { CreateAccountForm } from '@/components/forms/CreateAccountForm';
import { Notice } from '@/components/ui/Notice';
import { PageHeader } from '@/components/ui/PageHeader';
import { Frame } from '@/components/shell/Frames';
import { legalBasisText } from '@/components/shell/legal-basis-text';
import { listCourts } from '@/server/accounts/service';
import { recentlyReauthenticated } from '@/server/auth/sessions';
import { requirePage } from '@/server/permissions/guard';
import type { Metadata } from 'next';
import { screenMetadata } from '@/server/page-metadata';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.admin-accounts-new');

// «إنشاء حساب» (system administrator): any role, on a documented request,
// after re-authentication, with the three-line confirmation window.
export default async function NewAccountPage() {
  const context = await requirePage('admin.accounts.new', 'admin.accounts.list');
  const t = translator(context.locale);
  const courts = await listCourts();
  const rule = ACTIONS['admin.accounts.create'];
  const reauthed = recentlyReauthenticated(context.session.session, SECURITY_POLICY.reauth.windowMs / 60_000);
  const roles = ROLE_CODES.map((code) => ({
    code,
    label: t(roleLabelKey(code)),
    requiresCourt: ROLES[code].requiresCourt,
    requiresOrganization: ROLES[code].requiresOrganization,
    basis: legalBasisText(t, resolveLegalBasis(rule, { kind: 'account-draft', role: code })),
  }));
  return (
    <Frame context={context}>
      <PageHeader title={t('screens.admin-accounts-new')} intro={t('admin.form.intro')} />
      {reauthed ? null : (
        <div className="mb-6 max-w-2xl">
          <Notice tone="warning">
            {t('admin.form.reauthNeeded')} <a href="/reauth?next=/admin/accounts/new">{t('admin.form.reauthLink')}</a>
          </Notice>
        </div>
      )}
      <div className="card max-w-2xl px-5 py-6 sm:px-7">
        <CreateAccountForm
          roles={roles}
          courts={courts}
          messages={{ ...dictionary(context.locale, ['errors.']), 'screens.admin-accounts': t('screens.admin-accounts') }}
          labels={{
            fullName: t('admin.form.fullName'),
            email: t('admin.form.email'),
            phone: t('admin.form.phone'),
            role: t('admin.form.role'),
            court: t('admin.form.court'),
            courtNone: t('admin.form.courtNone'),
            organization: t('admin.form.organization'),
            requestReference: t('admin.accounts.requestReference'),
            requestReferenceHint: t('admin.form.requestReferenceHint'),
            submit: t(rule.labelKey),
            created: t('admin.form.created'),
            roleAdded: t('admin.form.roleAdded'),
            reauthNeeded: t('admin.form.reauthNeeded'),
            reauthLink: t('admin.form.reauthLink'),
          }}
          confirm={{
            title: t('actions.confirm.title'),
            effectLabel: t('actions.confirm.effect'),
            effectTemplate: t(rule.effectKey, { role: '{role}' }),
            effect: '',
            notifiedLabel: t('actions.confirm.notified'),
            notified: t(rule.notifiedKey),
            basisLabel: t('actions.confirm.legalBasis'),
            confirm: t('common.confirm'),
            cancel: t('common.cancel'),
          }}
        />
      </div>
    </Frame>
  );
}
