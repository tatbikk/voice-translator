'use client';

import { SECURITY_POLICY } from '@mahkama/core';
import { useState } from 'react';
import { apiPost, apiPostBytes, navigate } from '@/components/client/api';
import { errorText, tr, type Dict } from '@/components/client/messages';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, type ConfirmLines } from '@/components/ui/ConfirmDialog';

// A procedural act executed from a button (decision 46): the server listed it
// as available, the confirmation window shows its three lines, and the fields
// the act needs sit above them — a case type to correct the classification, a
// reason and a text for the note to the judge, a PDF for written conclusions.
// The server checks everything again under the file's lock.

export type ActKind = 'plain' | 'reclassify' | 'note' | 'upload';

export interface ActButtonProps {
  readonly caseFileId: string;
  readonly code: string;
  readonly kind: ActKind;
  readonly label: string;
  readonly lines: Omit<ConfirmLines, 'confirm' | 'cancel' | 'title'>;
  readonly dict: Dict;
  /** for «تصحيح التصنيف»: the case types of the table in force */
  readonly caseTypes?: readonly { readonly code: string; readonly name: string }[];
  readonly currentCaseType?: string | null;
  /** where to go once the act is done (the page shows the new state) */
  readonly after?: string;
}

const NOTE_REASONS = ['FEE_SHORTFALL', 'CLASSIFICATION', 'PARTIES', 'OTHER'] as const;
const CONTROL = 'block w-full min-h-11 rounded border border-line-strong bg-paper px-3 py-2 text-base';

export function CaseActionButton({ caseFileId, code, kind, label, lines, dict, caseTypes = [], currentCaseType = null, after }: ActButtonProps) {
  const t = (key: string, params?: Readonly<Record<string, string | number>>) => tr(dict, key, params);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caseType, setCaseType] = useState('');
  const [reason, setReason] = useState<(typeof NOTE_REASONS)[number]>('OTHER');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const id = `${code}-${caseFileId}`.replace(/[^a-z0-9-]/gi, '-');

  const act = async () => {
    setBusy(true);
    setError(null);
    const res =
      kind === 'upload'
        ? file
          ? await apiPostBytes(`/api/v1/cases/${caseFileId}/uploads/${code}`, { name: file.name }, file)
          : { ok: false as const, error: { code: 'INVALID_INPUT', messageKey: 'errors.INVALID_INPUT' } }
        : await apiPost(`/api/v1/cases/${caseFileId}/actions/${code}`, kind === 'reclassify' ? { caseType } : kind === 'note' ? { reason, text } : {});
    setBusy(false);
    if (!res.ok) {
      setError(errorText(dict, res.error.messageKey));
      return;
    }
    setOpen(false);
    navigate(after ?? window.location.pathname);
  };

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        busy={busy}
        error={error}
        onConfirm={() => void act()}
        lines={{ ...lines, title: label, confirm: t('common.confirm'), cancel: t('common.cancel') }}
      >
        {kind === 'reclassify' ? (
          <div>
            <label htmlFor={`${id}-type`} className="mb-1.5 block font-medium">
              {t('registry.reclassify.caseType')}
            </label>
            <select id={`${id}-type`} className={CONTROL} value={caseType} onChange={(e) => { setCaseType(e.target.value); }}>
              <option value="">{t('filing.choose')}</option>
              {caseTypes
                .filter((c) => c.code !== currentCaseType)
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {t('filing.court.caseTypeOption', { code: c.code, name: c.name })}
                  </option>
                ))}
            </select>
          </div>
        ) : null}
        {kind === 'note' ? (
          <div className="space-y-4">
            <div>
              <label htmlFor={`${id}-reason`} className="mb-1.5 block font-medium">
                {t('registry.note.reason')}
              </label>
              <select id={`${id}-reason`} className={CONTROL} value={reason} onChange={(e) => { setReason(e.target.value as (typeof NOTE_REASONS)[number]); }}>
                {NOTE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`registry.note.reasons.${r}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-text`} className="mb-1.5 block font-medium">
                {t('registry.note.text')}
              </label>
              <textarea id={`${id}-text`} rows={4} maxLength={2000} className={CONTROL} value={text} onChange={(e) => { setText(e.target.value); }} />
            </div>
          </div>
        ) : null}
        {kind === 'upload' ? (
          <div>
            <label htmlFor={`${id}-file`} className="mb-1.5 block font-medium">
              {t('case.act.file')}
            </label>
            <p className="mb-2 text-sm text-text-muted">{t('case.act.fileHint', { size: SECURITY_POLICY.uploads.conclusionsMaxBytes / (1024 * 1024) })}</p>
            <input id={`${id}-file`} type="file" accept=".pdf" onChange={(e) => { setFile(e.target.files?.[0] ?? null); }} />
          </div>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
