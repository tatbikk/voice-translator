'use client';

import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { navigate } from '@/components/client/api';
import { FormError } from './FormError';
import { useApiForm } from './useApiForm';
import { formText } from '@/components/client/form-data';

export function AccessForm({ labels, messages, next }: { labels: { code: string; submit: string }; messages: Record<string, string>; next: string }) {
  const form = useApiForm(messages);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const code = formText(new FormData(event.currentTarget), 'code');
        void form.submit<{ next: string }>('/api/v1/access', { code, next }).then((r) => {
          if (r.ok) navigate(r.data.next);
        });
      }}
    >
      <FormError text={form.error} />
      <Field id="code" label={labels.code} error={form.fields.code}>
        <TextInput id="code" type="password" autoComplete="off" required maxLength={256} />
      </Field>
      <Button type="submit" disabled={form.busy}>
        {labels.submit}
      </Button>
    </form>
  );
}
