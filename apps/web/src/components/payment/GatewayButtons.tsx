'use client';

import { useState } from 'react';
import { apiPost, navigate } from '@/components/client/api';
import { errorText, type Dict } from '@/components/client/messages';
import { Button } from '@/components/ui/Button';

// The three answers of the simulated gateway (prompt, «الأداء»): the payer
// chooses one; the server records it once and the page shows its result.

const OUTCOMES = ['SUCCEEDED', 'FAILED', 'CANCELLED'] as const;

export function GatewayButtons({ intentId, dict, labels }: { intentId: string; dict: Dict; labels: Readonly<Record<(typeof OUTCOMES)[number], string>> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = async (outcome: (typeof OUTCOMES)[number]) => {
    setBusy(true);
    setError(null);
    const res = await apiPost(`/api/v1/payments/${intentId}/outcome`, { outcome });
    if (!res.ok) {
      setBusy(false);
      setError(errorText(dict, res.error.messageKey));
      return;
    }
    navigate(`/payments/${intentId}`);
  };
  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {OUTCOMES.map((o) => (
          <Button key={o} variant={o === 'SUCCEEDED' ? 'primary' : 'secondary'} disabled={busy} onClick={() => void choose(o)}>
            {labels[o]}
          </Button>
        ))}
      </div>
      <p aria-live="polite" className={error ? 'mt-3 text-elapsed' : 'sr-only'}>
        {error ?? ''}
      </p>
    </div>
  );
}
