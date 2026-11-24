import { roleLabelKey, type RoleCode } from '@mahkama/core';
import { dictionary } from '@/i18n/dictionary';
import { translator } from '@/i18n/translate';
import { RoleChoice } from '@/components/forms/RoleChoice';
import { PageHeader } from '@/components/ui/PageHeader';
import { Frame } from '@/components/shell/Frames';
import { requirePending } from '@/server/permissions/guard';
import { rolesOf } from '@/server/accounts/roles';

// «اختيار الصفة»: at login for a user holding several roles, or later to switch.
export default async function RolePage() {
  const context = await requirePending('login.role', ['PENDING_ROLE'], { orAction: 'account.switch-role' });
  const t = translator(context.locale);
  const roles = await rolesOf(context.session.user.id);
  const current = context.session.roleAssignment?.id ?? null;
  return (
    <Frame context={context} width="narrow">
      <PageHeader title={t('screens.login-role')} intro={t('role.intro')} />
      <RoleChoice
        chooseLabel={t('role.choose')}
        currentLabel={t('role.current')}
        messages={dictionary(context.locale, ['errors.'])}
        roles={roles.map((r) => ({
          id: r.id,
          current: r.id === current && context.session.session.state === 'ACTIVE',
          label: r.courtName
            ? t('role.optionWithCourt', { role: t(roleLabelKey(r.role as RoleCode, r.courtDegree)), court: r.courtName })
            : t(roleLabelKey(r.role as RoleCode, r.courtDegree)),
        }))}
      />
    </Frame>
  );
}
