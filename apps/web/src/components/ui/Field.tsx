import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cx } from './cx';

const CONTROL =
  'block w-full min-h-12 rounded border border-line-strong bg-paper px-3 py-2 text-base text-text transition-colors ' +
  'hover:border-ink-700 focus:border-ink-800 aria-[invalid=true]:border-elapsed';

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="mb-5">
      <label htmlFor={id} className="mb-1.5 block font-medium text-ink-900">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="mb-2 text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
      {children}
      <p id={`${id}-error`} aria-live="polite" className={cx('mt-1 text-sm text-elapsed', !error && 'sr-only')}>
        {error ?? ''}
      </p>
    </div>
  );
}

export function TextInput({ id, invalid, describedBy, ...props }: InputHTMLAttributes<HTMLInputElement> & { id: string; invalid?: boolean; describedBy?: string }) {
  return (
    <input
      id={id}
      name={props.name ?? id}
      aria-invalid={invalid ? 'true' : 'false'}
      aria-describedby={describedBy ?? `${id}-error`}
      className={CONTROL}
      {...props}
    />
  );
}

export function SelectInput({
  id,
  invalid,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { id: string; invalid?: boolean; children: ReactNode }) {
  return (
    <select
      id={id}
      name={props.name ?? id}
      aria-invalid={invalid ? 'true' : 'false'}
      aria-describedby={`${id}-error`}
      className={CONTROL}
      {...props}
    >
      {children}
    </select>
  );
}
