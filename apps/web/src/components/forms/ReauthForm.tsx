'use client';

import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { navigate } from '@/components/client/api';
import { FormError } from './FormError';
import { useApiForm } from './useApiForm';
import { formText } from '@/components/client/form-data';

export function ReauthForm({ labels, messages, next }: { labels: { password: string; submit: string }; messages: Record<string, string>; next: string }) {
  const form = useApiForm(messages);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const password = formText(new FormData(event.currentTarget), 'password');
        void form.submit('/api/v1/auth/reauth', { password }).then((r) => {
          if (r.ok) navigate(next);
          else if (r.error.code === 'ACCOUNT_LOCKED') navigate('/login');
        });
      }}
    >
      <FormError text={form.error} />
      <Field id="password" label={labels.password} error={form.fields.password}>
        <TextInput id="password" type="password" autoComplete="current-password" required maxLength={128} />
      </Field>
      <Button type="submit" disabled={form.busy}>
        {labels.submit}
      </Button>
    </form>
  );
}
