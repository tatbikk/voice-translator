'use client';

import { Menu, type MenuEntry } from '@/components/ui/Menu';
import { apiPost, navigate } from '@/components/client/api';

export function AccountMenu({
  label,
  header,
  accountLabel,
  switchRoleLabel,
  logoutLabel,
  canSwitchRole,
  dir,
}: {
  label: string;
  header: string;
  accountLabel: string;
  switchRoleLabel: string;
  logoutLabel: string;
  canSwitchRole: boolean;
  dir: 'rtl' | 'ltr';
}) {
  const entries: MenuEntry[] = [{ key: 'account', label: accountLabel, href: '/account' }];
  if (canSwitchRole) entries.push({ key: 'role', label: switchRoleLabel, href: '/login/role' });
  entries.push({
    key: 'logout',
    label: logoutLabel,
    onSelect: () => {
      void apiPost('/api/v1/auth/logout').then(() => { navigate('/'); });
    },
  });
  return <Menu dir={dir} label={label} header={header} trigger={<span>{label}</span>} entries={entries} />;
}
