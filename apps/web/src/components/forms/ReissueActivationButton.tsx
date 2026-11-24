'use client';

import { useState } from 'react';
import { ActionButton } from '@/components/ui/ActionButton';
import type { ConfirmLines } from '@/components/ui/ConfirmDialog';
import { apiPost } from '@/components/client/api';

export function ReissueActivationButton({
  userId,
  label,
  lines,
  doneText,
  messages,
}: {
  userId: string;
  label: string;
  lines: ConfirmLines;
  doneText: string;
  messages: Record<string, string>;
}) {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <ActionButton
        variant="secondary"
        label={label}
        lines={lines}
        onConfirm={async () => {
          const r = await apiPost(`/api/v1/admin/accounts/${encodeURIComponent(userId)}/activation`);
          setStatus(r.ok ? doneText : (messages[r.error.messageKey] ?? messages['errors.INTERNAL'] ?? ''));
          return true;
        }}
      />
      <span aria-live="polite" className="text-sm">
        {status ?? ''}
      </span>
    </span>
  );
}
