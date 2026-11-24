'use client';

import { useEffect, useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Notice';
import { FormError } from './FormError';
import { useApiForm } from './useApiForm';
import { formText, sameText } from '@/components/client/form-data';

// The token is in the fragment of the link (#token=…): browsers never send the
// fragment to the server, so it reaches neither logs nor Referer headers. It is
// read here and posted in the request body.
export function ActivateForm({
  labels,
  messages,
}: {
  labels: { password: string; confirm: string; submit: string; done: string; mismatch: string; noToken: string; login: string; hint: string };
  messages: Record<string, string>;
}) {
  const form = useApiForm(messages);
  const [token, setToken] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token');
    setToken(value);
    if (value) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  if (done) {
    return (
      <>
        <Notice tone="success" live>
          {labels.done}
        </Notice>
        <p className="mt-6">
          <ButtonLink href="/login" variant="primary">
            {labels.login}
          </ButtonLink>
        </p>
      </>
    );
  }
  if (!token) return <Notice tone="warning">{labels.noToken}</Notice>;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const password = formText(data, 'password');
        if (!sameText(password, formText(data, 'passwordConfirm'))) {
          form.setError(labels.mismatch);
          return;
        }
        void form.submit('/api/v1/auth/activate', { token, password }).then((r) => {
          if (r.ok) setDone(true);
        });
      }}
    >
      <FormError text={form.error} />
      <Field id="password" label={labels.password} hint={labels.hint} error={form.fields.password}>
        <TextInput id="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      </Field>
      <Field id="passwordConfirm" label={labels.confirm}>
        <TextInput id="passwordConfirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      </Field>
      <Button type="submit" disabled={form.busy}>
        {labels.submit}
      </Button>
    </form>
  );
}
