'use client';

import { useState } from 'react';
import { apiPost, navigate } from '@/components/client/api';
import { errorText, type Dict } from '@/components/client/messages';
import { Button } from '@/components/ui/Button';

/** «دعوى جديدة» or «إيداع ورقي»: opens a new draft and its first screen. */
export function NewFilingButton({ path, label, dict, variant = 'primary' }: { path: '/api/v1/filings' | '/api/v1/filings/paper'; label: string; dict: Dict; variant?: 'primary' | 'secondary' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Button
        variant={variant}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void apiPost<{ draftId: string }>(path, {}).then((res) => {
            if (res.ok) {
              navigate(`/filings/${res.data.draftId}`);
              return;
            }
            setBusy(false);
            setError(errorText(dict, res.error.messageKey));
          });
        }}
      >
        {label}
      </Button>
      <p aria-live="polite" className={error ? 'mt-2 text-elapsed' : 'sr-only'}>
        {error ?? ''}
      </p>
    </div>
  );
}
