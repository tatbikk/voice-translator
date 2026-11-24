import { authorize, roleLabelKey, type RoleCode } from '@mahkama/core';
import { translator } from '@/i18n/translate';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { Frame } from '@/components/shell/Frames';
import { rolesOf } from '@/server/accounts/roles';
import { requirePage } from '@/server/permissions/guard';
import type { Metadata } from 'next';
import { screenMetadata } from '@/server/page-metadata';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.account');

const VERIFICATION_KEY = {
  VERIFIED_SIMULATED: 'identity.verifiedSimulated',
  VERIFIED: 'identity.verified',
  UNVERIFIED: 'identity.unverified',
} as const;

// «الحساب الشخصي»: identity, roles and how each role was verified.
export default async function AccountPage() {
  const context = await requirePage('account', 'account.view-own');
  const t = translator(context.locale);
  const { user, roleAssignment } = context.session;
  const roles = await rolesOf(user.id);
  const canSwitch = authorize(context.subject, 'account.switch-role', undefined, {
    mode: context.mode,
    demoToolsEnabled: context.demoToolsEnabled,
  }).allowed;

  const identity = (
    <dl className="grid max-w-2xl gap-3 sm:grid-cols-[12rem_1fr]">
      <dt className="font-semibold">{t('account.name')}</dt>
      <dd>{user.fullName}</dd>
      <dt className="font-semibold">{t('account.email')}</dt>
      <dd>
        <bdi dir="ltr">{user.email}</bdi>
      </dd>
      <dt className="font-semibold">{t('account.phone')}</dt>
      <dd>
        <bdi dir="ltr">{user.phone}</bdi>
      </dd>
      {user.isDemo ? (
        <>
          <dt className="sr-only">{t('account.title')}</dt>
          <dd className="text-text-muted sm:col-span-2">{t('account.demoAccount')}</dd>
        </>
      ) : null}
    </dl>
  );

  const roleList = (
    <div>
      <ul className="divide-y divide-line border border-line bg-paper">
        {roles.map((r) => (
          <li key={r.id} className="grid gap-1 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="font-semibold">
                {t(roleLabelKey(r.role as RoleCode, r.courtDegree))}
                {r.id === roleAssignment?.id ? <span className="ms-3 text-sm font-normal text-text-muted">{t('account.currentRole')}</span> : null}
              </p>
              {r.courtName ? <p className="text-text-muted">{r.courtName}</p> : null}
            </div>
            <p className="text-sm">
              <span className="text-text-muted">{t('account.verification')}: </span>
              {t(VERIFICATION_KEY[r.verificationStatus])}
            </p>
          </li>
        ))}
      </ul>
      {canSwitch ? (
        <p className="mt-5">
          <ButtonLink href="/login/role">{t('account.switchRole')}</ButtonLink>
        </p>
      ) : null}
    </div>
  );

  return (
    <Frame context={context}>
      <PageHeader title={t('screens.account')} />
      <Tabs
        label={t('screens.account')}
        items={[
          { id: 'identity', label: t('account.identity'), content: identity },
          { id: 'roles', label: t('account.roles'), content: roleList },
        ]}
      />
    </Frame>
  );
}
