'use client';

import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { navigate } from '@/components/client/api';
import { FormError } from './FormError';
import { useApiForm } from './useApiForm';
import { formText } from '@/components/client/form-data';

export function LoginForm({
  labels,
  messages,
}: {
  labels: { email: string; password: string; submit: string };
  messages: Record<string, string>;
}) {
  const form = useApiForm(messages);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void form
          .submit('/api/v1/auth/login', { email: formText(data, 'email'), password: formText(data, 'password') })
          .then((r) => {
            if (r.ok) navigate('/login/confirm');
          });
      }}
    >
      <FormError text={form.error} />
      <Field id="email" label={labels.email} error={form.fields.email}>
        <TextInput id="email" type="email" autoComplete="username" dir="ltr" required maxLength={254} />
      </Field>
      <Field id="password" label={labels.password} error={form.fields.password}>
        <TextInput id="password" type="password" autoComplete="current-password" required maxLength={128} />
      </Field>
      <Button type="submit" disabled={form.busy}>
        {labels.submit}
      </Button>
    </form>
  );
}
