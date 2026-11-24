'use client';

import { useState } from 'react';
import { apiPost, type ApiResult } from '@/components/client/api';

/** Submission state shared by the forms: busy flag, form error, field errors. */
export function useApiForm(messages: Readonly<Record<string, string>>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const text = (key: string) => messages[key] ?? messages['errors.INTERNAL'] ?? key;

  async function submit<T>(path: string, body: unknown): Promise<ApiResult<T>> {
    setBusy(true);
    setError(null);
    setFields({});
    const result = await apiPost<T>(path, body);
    setBusy(false);
    if (!result.ok) {
      setError(text(result.error.messageKey));
      const mapped: Record<string, string> = {};
      for (const [name, key] of Object.entries(result.error.fields ?? {})) mapped[name] = text(key);
      setFields(mapped);
    }
    return result;
  }

  return { busy, error, fields, submit, setError };
}
