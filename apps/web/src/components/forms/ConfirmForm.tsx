'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Notice';
import { navigate } from '@/components/client/api';
import { FormError } from './FormError';
import { useApiForm } from './useApiForm';
import { formText } from '@/components/client/form-data';

export function ConfirmForm({
  labels,
  messages,
}: {
  labels: { code: string; submit: string; resend: string; resent: string };
  messages: Record<string, string>;
}) {
  const form = useApiForm(messages);
  const [resent, setResent] = useState(false);
  return (
    <>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const code = formText(new FormData(event.currentTarget), 'code').trim();
          void form.submit<{ next: 'dashboard' | 'role' }>('/api/v1/auth/second-factor', { code }).then((r) => {
            if (r.ok) navigate(r.data.next === 'role' ? '/login/role' : '/dashboard');
            else if (r.error.code === 'ACCOUNT_LOCKED' || r.error.code === 'SESSION_REQUIRED') navigate('/login');
          });
        }}
      >
        <FormError text={form.error} />
        <Field id="code" label={labels.code} error={form.fields.code}>
          <TextInput id="code" inputMode="numeric" autoComplete="one-time-code" dir="ltr" pattern="[0-9]{6}" maxLength={6} required />
        </Field>
        <Button type="submit" disabled={form.busy}>
          {labels.submit}
        </Button>
      </form>
      <div className="mt-6">
        {resent ? <Notice live>{labels.resent}</Notice> : null}
        <Button
          variant="quiet"
          disabled={form.busy}
          onClick={() => {
            setResent(false);
            void form.submit('/api/v1/auth/second-factor/resend', {}).then((r) => { setResent(r.ok); });
          }}
        >
          {labels.resend}
        </Button>
      </div>
    </>
  );
}
