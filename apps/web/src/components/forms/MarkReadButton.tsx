'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { apiPost } from '@/components/client/api';

export function MarkReadButton({ id, label, doneLabel }: { id: string; label: string; doneLabel: string }) {
  const [done, setDone] = useState(false);
  if (done) return <span className="text-sm text-text-muted">{doneLabel}</span>;
  return (
    <Button
      variant="quiet"
      onClick={() => {
        void apiPost(`/api/v1/notifications/${encodeURIComponent(id)}/read`).then((r) => { setDone(r.ok); });
      }}
    >
      {label}
    </Button>
  );
}
