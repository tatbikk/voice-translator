'use client';

import { useRef, useState } from 'react';
import { ActionButton } from '@/components/ui/ActionButton';
import type { ConfirmLines } from '@/components/ui/ConfirmDialog';
import { Field, SelectInput, TextInput } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Notice';
import { FormError } from './FormError';
import { useApiForm } from './useApiForm';
import { formText } from '@/components/client/form-data';

export interface RoleOption {
  readonly code: string;
  readonly label: string;
  readonly requiresCourt: boolean;
  readonly requiresOrganization: boolean;
  /** third line of the confirmation window for this role */
  readonly basis: string;
}

export function CreateAccountForm({
  labels,
  roles,
  courts,
  messages,
  confirm,
}: {
  labels: {
    fullName: string;
    email: string;
    phone: string;
    role: string;
    court: string;
    courtNone: string;
    organization: string;
    requestReference: string;
    requestReferenceHint: string;
    submit: string;
    created: string;
    roleAdded: string;
    reauthNeeded: string;
    reauthLink: string;
  };
  roles: readonly RoleOption[];
  courts: readonly { id: string; name: string }[];
  messages: Record<string, string>;
  /** templates of the confirmation window; {role} is replaced by the chosen role */
  confirm: Omit<ConfirmLines, 'basis'> & { effectTemplate: string };
}) {
  const form = useApiForm(messages);
  const formRef = useRef<HTMLFormElement>(null);
  const [roleCode, setRoleCode] = useState(roles[0]?.code ?? '');
  const [result, setResult] = useState<'created' | 'added' | 'reauth' | null>(null);
  const role = roles.find((r) => r.code === roleCode) ?? roles[0];

  const lines: ConfirmLines = {
    ...confirm,
    effect: confirm.effectTemplate.replace('{role}', role?.label ?? ''),
    basis: role?.basis ?? '',
  };

  const send = async (): Promise<boolean> => {
    const el = formRef.current;
    if (!el) return true;
    const data = new FormData(el);
    const body: Record<string, string> = {
      fullName: formText(data, 'fullName'),
      email: formText(data, 'email'),
      phone: formText(data, 'phone'),
      role: roleCode,
      requestReference: formText(data, 'requestReference'),
    };
    const courtId = formText(data, 'courtId');
    if (courtId) body.courtId = courtId;
    const organizationName = formText(data, 'organizationName');
    if (organizationName) body.organizationName = organizationName;
    const r = await form.submit<{ activationSent: boolean }>('/api/v1/admin/accounts', body);
    if (r.ok) {
      setResult(r.data.activationSent ? 'created' : 'added');
      el.reset();
    } else if (r.error.code === 'REAUTH_REQUIRED') {
      setResult('reauth');
    }
    return true;
  };

  return (
    <form ref={formRef} noValidate onSubmit={(event) => { event.preventDefault(); }}>
      {result === 'created' ? <Notice tone="success" live>{labels.created}</Notice> : null}
      {result === 'added' ? <Notice tone="success" live>{labels.roleAdded}</Notice> : null}
      {result === 'reauth' ? (
        <Notice tone="warning">
          {labels.reauthNeeded} <a href="/reauth?next=/admin/accounts/new">{labels.reauthLink}</a>
        </Notice>
      ) : null}
      <div className="mt-5">
        <FormError text={result === 'reauth' ? null : form.error} />
      </div>
      <Field id="fullName" label={labels.fullName} error={form.fields.fullName}>
        <TextInput id="fullName" autoComplete="off" required maxLength={120} />
      </Field>
      <Field id="email" label={labels.email} error={form.fields.email}>
        <TextInput id="email" type="email" dir="ltr" autoComplete="off" required maxLength={254} />
      </Field>
      <Field id="phone" label={labels.phone} error={form.fields.phone}>
        <TextInput id="phone" type="tel" dir="ltr" autoComplete="off" required maxLength={32} />
      </Field>
      <Field id="role" label={labels.role} error={form.fields.role}>
        <SelectInput id="role" value={roleCode} onChange={(event) => { setRoleCode(event.target.value); }}>
          {roles.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </SelectInput>
      </Field>
      {role?.requiresCourt ? (
        <Field id="courtId" label={labels.court} error={form.fields.courtId}>
          <SelectInput id="courtId" defaultValue="">
            <option value="">{labels.courtNone}</option>
            {courts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectInput>
        </Field>
      ) : null}
      {role?.requiresOrganization ? (
        <Field id="organizationName" label={labels.organization} error={form.fields.organizationName}>
          <TextInput id="organizationName" autoComplete="off" maxLength={120} />
        </Field>
      ) : null}
      <Field id="requestReference" label={labels.requestReference} hint={labels.requestReferenceHint} error={form.fields.requestReference}>
        <TextInput id="requestReference" autoComplete="off" required minLength={8} maxLength={64} describedBy="requestReference-hint requestReference-error" />
      </Field>
      <ActionButton label={labels.submit} lines={lines} onConfirm={send} disabled={form.busy} />
      {result === 'created' || result === 'added' ? (
        <p className="mt-6">
          <a href="/admin/accounts">
            {messages['screens.admin-accounts'] ?? ''}
          </a>
        </p>
      ) : null}
    </form>
  );
}
