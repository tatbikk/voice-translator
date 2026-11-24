'use client';

import { Button } from '@/components/ui/Button';
import { navigate } from '@/components/client/api';
import { FormError } from './FormError';
import { useApiForm } from './useApiForm';

export function RoleChoice({
  roles,
  chooseLabel,
  currentLabel,
  messages,
}: {
  roles: readonly { id: string; label: string; current: boolean }[];
  chooseLabel: string;
  currentLabel: string;
  messages: Record<string, string>;
}) {
  const form = useApiForm(messages);
  return (
    <>
      <FormError text={form.error} />
      <ul className="divide-y divide-line border border-line bg-paper">
        {roles.map((role) => (
          <li key={role.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <span className="font-medium">{role.label}</span>
            {role.current ? (
              <span className="text-sm text-text-muted">{currentLabel}</span>
            ) : (
              <Button
                variant="secondary"
                disabled={form.busy}
                onClick={() => {
                  void form.submit('/api/v1/auth/role', { roleAssignmentId: role.id }).then((r) => {
                    if (r.ok) navigate('/dashboard');
                  });
                }}
              >
                {chooseLabel}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
