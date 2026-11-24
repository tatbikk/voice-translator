'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { apiGet } from '@/components/client/api';

interface Labels {
  readonly button: string;
  readonly checking: string;
  readonly valid: string;
  readonly changed: string;
  readonly invalid: string;
  readonly none: string;
  readonly failed: string;
}

/** «التحقق من التوقيع»: asks the server to recompute the document's hash against every signature. */
export function VerifySignatures({ caseId, documentId, labels }: { caseId: string; documentId: string; labels: Labels }) {
  const [state, setState] = useState<'idle' | 'checking' | 'done' | 'failed'>('idle');
  const [result, setResult] = useState<string>('');
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="quiet"
        disabled={state === 'checking'}
        onClick={() => {
          setState('checking');
          void apiGet<{ signatures: { status: string }[] }>(
            `/api/v1/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/signatures`,
          ).then((r) => {
            if (!r.ok) {
              setState('failed');
              return;
            }
            const list = r.data.signatures;
            const text =
              list.length === 0
                ? labels.none
                : list.every((s) => s.status === 'VALID')
                  ? labels.valid
                  : list.some((s) => s.status === 'INVALID')
                    ? labels.invalid
                    : labels.changed;
            setResult(text);
            setState('done');
          });
        }}
      >
        {labels.button}
      </Button>
      <span role="status" aria-live="polite" className="text-sm">
        {state === 'checking' ? labels.checking : state === 'done' ? result : state === 'failed' ? labels.failed : ''}
      </span>
    </span>
  );
}
