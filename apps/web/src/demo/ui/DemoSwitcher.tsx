'use client';

import { useId, useState } from 'react';
import { apiPost, navigate } from '@/components/client/api';
import { buttonClass } from '@/components/ui/Button';

export function DemoSwitcher({
  label,
  chooseLabel,
  submitLabel,
  errorText,
  options,
}: {
  label: string;
  chooseLabel: string;
  submitLabel: string;
  errorText: string;
  options: readonly { value: string; label: string }[];
}) {
  const id = useId();
  const [selected, setSelected] = useState(options[0]?.value ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void apiPost<{ next: string }>(`/api/demo/switch-account?roleAssignmentId=${encodeURIComponent(selected)}`).then((result) => {
          setBusy(false);
          if (result.ok) navigate(result.data.next);
          else setError(errorText);
        });
      }}
    >
      <div>
        <label htmlFor={id} className="block text-sm">
          {label}
        </label>
        <select
          id={id}
          value={selected}
          onChange={(event) => { setSelected(event.target.value); }}
          className="min-h-11 max-w-[80vw] border border-line-strong bg-paper px-2"
          aria-describedby={`${id}-hint`}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span id={`${id}-hint`} className="sr-only">
          {chooseLabel}
        </span>
      </div>
      <button type="submit" className={buttonClass('secondary')} disabled={busy || !selected}>
        {submitLabel}
      </button>
      <p aria-live="polite" className="text-sm text-elapsed">
        {error ?? ''}
      </p>
    </form>
  );
}
