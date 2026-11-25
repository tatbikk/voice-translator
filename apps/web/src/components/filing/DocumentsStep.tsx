'use client';

import { SECURITY_POLICY } from '@mahkama/core';
import { useEffect, useState } from 'react';
import { apiPost, apiPostBytes } from '@/components/client/api';
import { Button } from '@/components/ui/Button';
import { CONTROL, Field, type StepProps } from './parts';

// 4. The exhibits (art. 631): each with its title and its declared nature among
// «أصلية» «نسخة مطابقة للأصل» «صورة شمسية»; at the registry office, also its
// pages and the place where its paper original is kept. A file is sent as soon
// as it is chosen, and the server reads its type from its content.

const NATURES = ['ORIGINAL', 'CERTIFIED_COPY', 'PHOTOCOPY'] as const;

interface Row {
  readonly title: string;
  readonly nature: string;
  readonly pages: string;
  readonly location: string;
}

const rowOf = (d: StepProps['view']['documents'][number]): Row => ({
  title: d.title ?? '',
  nature: d.declaredNature ?? '',
  pages: d.pageCount === null ? '' : String(d.pageCount),
  location: d.paperOriginalLocation ?? '',
});

export function DocumentsStep({ view, t, busy, run, base }: StepProps) {
  const paper = view.draft.channel === 'PAPER';
  const exhibits = view.documents.filter((d) => d.kind === 'EXHIBIT');
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(exhibits.map((d) => [d.id, rowOf(d)])));
  const [uploading, setUploading] = useState(false);

  // A document just added appears with what the server recorded of it.
  useEffect(() => {
    setRows((current) => {
      const next = { ...current };
      for (const d of view.documents) if (d.kind === 'EXHIBIT' && !next[d.id]) next[d.id] = rowOf(d);
      return next;
    });
  }, [view.documents]);

  const add = async (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      await run(() => apiPostBytes(`${base}/documents`, { kind: 'EXHIBIT', name: file.name }, file), t('filing.documents.added', { name: file.name }));
    }
    setUploading(false);
  };

  const save = async () => {
    for (const d of exhibits) {
      const row = rows[d.id];
      if (!row) continue;
      const before = rowOf(d);
      const body: Record<string, unknown> = {};
      if (row.title.trim() !== '' && row.title !== before.title) body.title = row.title;
      if (row.nature !== before.nature) body.nature = row.nature === '' ? null : row.nature;
      if (paper && row.pages !== before.pages) body.pageCount = row.pages === '' ? null : Number(row.pages);
      if (paper && row.location !== before.location) body.location = row.location.trim() === '' ? null : row.location;
      if (Object.keys(body).length === 0) continue;
      if (!(await run(() => apiPost(`${base}/documents/${d.id}`, body)))) return;
    }
    await run(() => Promise.resolve({ ok: true }));
  };

  const remove = (id: string) => run(() => apiPost(`${base}/documents/${id}`, { remove: true }), t('filing.documents.removed'));
  const set = (id: string, patch: Partial<Row>) => {
    setRows((r) => ({ ...r, [id]: { ...(r[id] ?? { title: '', nature: '', pages: '', location: '' }), ...patch } }));
  };

  return (
    <div>
      <p className="mb-5 text-text-muted">{t(paper ? 'filing.documents.introPaper' : 'filing.documents.intro')}</p>
      <Field id="addExhibit" label={t('filing.documents.add')} hint={t(paper ? 'filing.documents.typesPaper' : 'filing.documents.types', { size: (paper ? SECURITY_POLICY.uploads.scanMaxBytes : SECURITY_POLICY.uploads.exhibitMaxBytes) / (1024 * 1024) })}>
        <input
          id="addExhibit"
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
          disabled={uploading}
          className="block"
          onChange={(e) => {
            void add(e.target.files);
            e.target.value = '';
          }}
        />
      </Field>

      {exhibits.length === 0 ? <p className="mb-5">{t('filing.documents.none')}</p> : null}
      {exhibits.map((d, index) => {
        const row = rows[d.id] ?? rowOf(d);
        return (
          <fieldset key={d.id} className="mb-4 rounded border border-line px-4 py-4">
            <legend className="px-1 font-semibold">{d.title ?? t('filing.documents.untitled', { n: index + 1 })}</legend>
            <div className="grid gap-x-6 sm:grid-cols-2">
              <Field id={`${d.id}-title`} label={t('filing.documents.title')}>
                <input id={`${d.id}-title`} className={CONTROL} value={row.title} onChange={(e) => { set(d.id, { title: e.target.value }); }} />
              </Field>
              <Field id={`${d.id}-nature`} label={t('terms.documentNature')}>
                <select id={`${d.id}-nature`} className={CONTROL} value={row.nature} onChange={(e) => { set(d.id, { nature: e.target.value }); }}>
                  <option value="">{t('filing.choose')}</option>
                  {NATURES.map((n) => (
                    <option key={n} value={n}>
                      {t(`case.nature.${n}`)}
                    </option>
                  ))}
                </select>
              </Field>
              {paper ? (
                <>
                  <Field id={`${d.id}-pages`} label={t('filing.application.pages')}>
                    <input id={`${d.id}-pages`} type="number" min={1} inputMode="numeric" className={CONTROL} value={row.pages} onChange={(e) => { set(d.id, { pages: e.target.value }); }} />
                  </Field>
                  <Field id={`${d.id}-location`} label={t('filing.application.originalLocation')}>
                    <input id={`${d.id}-location`} className={CONTROL} value={row.location} onChange={(e) => { set(d.id, { location: e.target.value }); }} />
                  </Field>
                </>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <a href={`${base}/documents/${d.id}/file`}>{t('filing.download')}</a>
              <Button variant="quiet" disabled={busy} onClick={() => void remove(d.id)}>
                {t('filing.documents.remove')}
              </Button>
            </div>
          </fieldset>
        );
      })}
      <Button disabled={busy || uploading} onClick={() => void save()}>
        {t('filing.save')}
      </Button>
    </div>
  );
}
