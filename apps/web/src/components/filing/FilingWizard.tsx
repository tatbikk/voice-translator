'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CardSection, FilingCard } from '@mahkama/core';
import { apiGet, apiPost, apiPostBytes, navigate } from '@/components/client/api';
import { errorText, tr, type Dict } from '@/components/client/messages';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Notice } from '@/components/ui/Notice';
import type { DraftView } from '@/server/filings/drafts';
import { CardStep } from './CardStep';
import { DocumentsStep } from './DocumentsStep';
import { FeeStep } from './FeeStep';
import { CONTROL, Choice, Field, LabeledInput, StepFrame, type StepProps } from './parts';

// «دعوى جديدة» (study, «واجهة المحامي» and «المرحلة الأولى»): six screens the
// lawyer moves between freely, each saving its own part of the draft. The
// server decides everything (the court suggested, the fee, the checks); the
// screens only show what it answered. The registry clerk walks the same screens
// for a paper filing (decision 59), the signature replaced by the clerk's
// authentication of the card.

export const STEP_KEYS = ['court', 'application', 'card', 'documents', 'fee', 'sign'] as const;

export interface WizardProps {
  readonly initial: DraftView;
  readonly dict: Dict;
  readonly initialStep: number;
  readonly demo: boolean;
  /** the three lines of the confirmation window of «التوقيع والإيداع» (rule 1 of the prompt) */
  readonly submitLines: { readonly effect: string; readonly notified: string; readonly basis: string };
}

export function FilingWizard({ initial, dict, initialStep, demo, submitLines }: WizardProps) {
  const [view, setView] = useState<DraftView>(initial);
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 0), STEP_KEYS.length - 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const t = useCallback((key: string, params?: Readonly<Record<string, string | number>>) => tr(dict, key, params), [dict]);
  const base = `/api/v1/filings/${view.draft.id}`;

  const refresh = useCallback(async () => {
    const res = await apiGet<DraftView>(base);
    if (res.ok) setView(res.data);
    return res.ok ? res.data : null;
  }, [base]);

  /** Runs one change of the draft; true when the server accepted it. */
  const run = useCallback(
    async (work: () => Promise<{ ok: true; data?: unknown } | { ok: false; error: { messageKey: string } }>, savedText = t('filing.saved')): Promise<boolean> => {
      setBusy(true);
      setError(null);
      setSaved(null);
      const res = await work();
      setBusy(false);
      if (!res.ok) {
        setError(errorText(dict, res.error.messageKey));
        return false;
      }
      await refresh();
      setSaved(savedText);
      return true;
    },
    [dict, refresh, t],
  );

  const update = useCallback((body: Record<string, unknown>) => run(() => apiPost<DraftView>(base, body)), [base, run]);

  const goTo = (index: number) => {
    setError(null);
    setSaved(null);
    setStep(index);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const props: StepProps = { view, dict, t, busy, update, run, refresh, base };
  const paper = view.draft.channel === 'PAPER';

  return (
    <div>
      {demo ? (
        <div className="mb-6">
          <Notice tone="warning">{t('filing.demoNotice')}</Notice>
        </div>
      ) : null}
      <nav aria-label={t('filing.steps.label')} className="mb-8">
        <ol className="flex flex-wrap gap-2">
          {STEP_KEYS.map((key, index) => (
            <li key={key}>
              {/* Links, not buttons: a screen's name never doubles the name of the button that acts on it. */}
              <a
                href={`/filings/${view.draft.id}?step=${String(index + 1)}`}
                className={
                  index === step
                    ? 'inline-block rounded border border-ink-800 bg-ink-800 px-3 py-1.5 text-sm text-white no-underline'
                    : 'inline-block rounded border border-line-strong bg-paper px-3 py-1.5 text-sm text-ink-800 no-underline hover:border-ink-800'
                }
                aria-current={index === step ? 'step' : undefined}
              >
                {t('filing.steps.position', { n: index + 1 })} {t(`filing.steps.${key}`)}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <StepFrame
        headingRef={headingRef}
        title={t(`filing.steps.${STEP_KEYS[step] ?? 'court'}`)}
        region={STEP_KEYS[step] === 'fee'}
      >
        {step === 0 ? <CourtStep {...props} /> : null}
        {step === 1 ? <ApplicationStep {...props} /> : null}
        {step === 2 ? <CardStep {...props} /> : null}
        {step === 3 ? <DocumentsStep {...props} /> : null}
        {step === 4 ? <FeeStep {...props} /> : null}
        {step === 5 ? <SignStep {...props} submitLines={submitLines} paper={paper} /> : null}
      </StepFrame>

      <p aria-live="polite" className={error ? 'mt-4 text-elapsed' : saved ? 'mt-4 text-text-muted' : 'sr-only'}>
        {error ?? saved ?? ''}
      </p>

      {step < STEP_KEYS.length - 1 ? (
        <div className="mt-8 border-t border-line pt-5">
          <Button
            variant="secondary"
            onClick={() => {
              goTo(step + 1);
            }}
          >
            {t('filing.next')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. The case type and the court

function CourtStep({ view, t, busy, update }: StepProps) {
  const d = view.draft;
  const paper = d.channel === 'PAPER';
  const [caseType, setCaseType] = useState(d.caseType ?? '');
  const [locality, setLocality] = useState(d.defendantLocality ?? '');
  const [courtId, setCourtId] = useState(d.courtId ?? '');
  const suggestion = view.suggestion;

  useEffect(() => {
    setCourtId(view.draft.courtId ?? '');
  }, [view.draft.courtId]);

  const save = async () => {
    const body: Record<string, unknown> = { caseType: caseType === '' ? null : caseType };
    if (!paper) body.defendantLocality = locality === '' ? null : locality;
    if (!paper && courtId !== '') body.courtId = courtId;
    const accepted = await update(body);
    if (!accepted || paper) return;
    // The suggestion fills the court the lawyer has not chosen yet; the choice stays his.
    const res = await apiGet<DraftView>(`/api/v1/filings/${d.id}`);
    if (res.ok && !res.data.draft.courtId && res.data.suggestion?.courtId) await update({ courtId: res.data.suggestion.courtId });
  };

  return (
    <div>
      <p className="mb-5 text-text-muted">{t(paper ? 'filing.court.introPaper' : 'filing.court.intro')}</p>
      <Field id="caseType" label={t('filing.court.caseType')}>
        <select id="caseType" className={CONTROL} value={caseType} onChange={(e) => { setCaseType(e.target.value); }}>
          <option value="">{t('filing.choose')}</option>
          {view.caseTypes.map((c) => (
            <option key={c.code} value={c.code}>
              {t('filing.court.caseTypeOption', { code: c.code, name: t(`case.type.${c.code}`) })}
            </option>
          ))}
        </select>
      </Field>
      {paper ? null : (
        <Field id="defendantLocality" label={t('filing.court.defendantLocality')} hint={t('filing.court.defendantLocalityHint')}>
          <select id="defendantLocality" className={CONTROL} value={locality} onChange={(e) => { setLocality(e.target.value); }}>
            <option value="">{t('filing.choose')}</option>
            {view.localities.map((code) => (
              <option key={code} value={code}>
                {t(`localities.${code}`)}
              </option>
            ))}
          </select>
        </Field>
      )}

      {!paper && suggestion ? (
        // Named by its title, not by a label: the court field below must stay the only one named «المحكمة».
        <section role="region" title={t('filing.court.suggested')} className="mb-6 rounded border border-line bg-ink-50 px-4 py-4">
          <h3 className="text-lg font-semibold">{t('filing.court.suggested')}</h3>
          {suggestion.courtId ? (
            <>
              <p className="mt-2 font-semibold">{suggestion.courtName}</p>
              <p className="mt-1 text-sm text-text-muted">{t(`filing.court.reason.${suggestion.reason}`)}</p>
            </>
          ) : (
            <p className="mt-2">{t(`filing.court.reason.${suggestion.reason}`)}</p>
          )}
          {suggestion.articles.length > 0 ? <p className="mt-1 text-sm">{t('filing.court.basis', { basis: basisOf(t, suggestion.articles) })}</p> : null}
          {suggestion.thresholdExceeded === false ? <p className="mt-2 text-sm text-elapsed">{t('filing.court.thresholdNotExceeded')}</p> : null}
          <p className="mt-2 text-sm text-text-muted">{t('filing.court.choiceIsYours')}</p>
        </section>
      ) : null}

      <Field id="courtId" label={t('filing.court.court')}>
        <select id="courtId" className={CONTROL} value={courtId} disabled={paper} onChange={(e) => { setCourtId(e.target.value); }}>
          <option value="">{t('filing.choose')}</option>
          {view.courts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Button disabled={busy} onClick={() => void save()}>
        {t('filing.save')}
      </Button>
    </div>
  );
}

function basisOf(t: StepProps['t'], articles: readonly number[]): string {
  const list = articles.join(t('actions.basis.articleSeparator'));
  const key = articles.length === 1 ? 'actions.basis.article' : articles.length === 2 ? 'actions.basis.articles.two' : 'actions.basis.articles.many';
  return t(key, { articles: list });
}

// ---------------------------------------------------------------------------
// 2. The application

const POLL_MS = 2000;
const POLL_ROUNDS = 45;

function ApplicationStep({ view, t, busy, run, refresh, base }: StepProps) {
  const d = view.draft;
  const paper = d.channel === 'PAPER';
  const [mode, setMode] = useState<'UPLOAD' | 'PASTE'>(d.applicationMode === 'UPLOAD' ? 'UPLOAD' : 'PASTE');
  const [text, setText] = useState(d.applicationText ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState('');
  const [location, setLocation] = useState('');
  const application = view.documents.find((doc) => doc.kind === 'APPLICATION_COPY') ?? view.documents.find((doc) => doc.kind === 'APPLICATION_ORIGINAL') ?? null;

  // The fixed copy is printed by the worker: the screen asks again until it is ready.
  useEffect(() => {
    if (d.fixedCopyStatus !== 'PENDING') return undefined;
    let rounds = 0;
    const timer = setInterval(() => {
      rounds += 1;
      void refresh().then((next) => {
        if (!next || next.draft.fixedCopyStatus !== 'PENDING' || rounds >= POLL_ROUNDS) clearInterval(timer);
      });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [d.fixedCopyStatus, refresh]);

  const save = async () => {
    if (!paper && mode === 'PASTE') {
      await run(() => apiPost(`${base}/application-text`, { text }));
      return;
    }
    if (!file) return;
    await run(() =>
      apiPostBytes(`${base}/documents`, { kind: 'APPLICATION', name: file.name, ...(paper ? { pages: pages === '' ? undefined : Number(pages), location } : {}) }, file),
    );
    setFile(null);
  };

  return (
    <div>
      <p className="mb-5 text-text-muted">{t(paper ? 'filing.application.introPaper' : 'filing.application.intro')}</p>
      {paper ? (
        <>
          <LabeledInput id="applicationFile" label={t('filing.application.upload')} hint={t('filing.application.scanTypes')}>
            <input id="applicationFile" type="file" accept=".pdf,.jpg,.jpeg,.png" className="block" onChange={(e) => { setFile(e.target.files?.[0] ?? null); }} />
          </LabeledInput>
          <LabeledInput id="applicationPages" label={t('filing.application.pages')}>
            <input id="applicationPages" type="number" min={1} inputMode="numeric" className={CONTROL} value={pages} onChange={(e) => { setPages(e.target.value); }} />
          </LabeledInput>
          <LabeledInput id="applicationLocation" label={t('filing.application.originalLocation')}>
            <input id="applicationLocation" className={CONTROL} value={location} onChange={(e) => { setLocation(e.target.value); }} />
          </LabeledInput>
        </>
      ) : (
        <>
          <fieldset className="mb-5">
            <legend className="mb-2 font-medium">{t('filing.application.mode')}</legend>
            <div className="flex flex-wrap gap-6">
              <Choice name="applicationMode" checked={mode === 'UPLOAD'} onChange={() => { setMode('UPLOAD'); }} label={t('filing.application.upload')} />
              <Choice name="applicationMode" checked={mode === 'PASTE'} onChange={() => { setMode('PASTE'); }} label={t('filing.application.paste')} />
            </div>
          </fieldset>
          {mode === 'PASTE' ? (
            <LabeledInput id="applicationText" label={t('filing.application.text')} hint={t('filing.application.textHint')}>
              <textarea id="applicationText" rows={12} className={CONTROL} value={text} onChange={(e) => { setText(e.target.value); }} />
            </LabeledInput>
          ) : (
            <LabeledInput id="applicationFile" label={t('filing.application.file')} hint={t('filing.application.fileTypes')}>
              <input id="applicationFile" type="file" accept=".pdf,.docx" className="block" onChange={(e) => { setFile(e.target.files?.[0] ?? null); }} />
            </LabeledInput>
          )}
        </>
      )}
      <Button disabled={busy} onClick={() => void save()}>
        {t('filing.save')}
      </Button>

      <div className="mt-6" aria-live="polite">
        {d.fixedCopyStatus === 'PENDING' ? <p>{t('filing.application.fixedCopyPending')}</p> : null}
        {d.fixedCopyStatus === 'READY' && application ? (
          <p>
            {t('filing.application.fixedCopyReady')}{' '}
            <a href={`${base}/documents/${application.id}/file`}>{t('filing.download')}</a>
          </p>
        ) : null}
        {d.fixedCopyStatus === 'FAILED' ? <p className="text-elapsed">{t('filing.application.fixedCopyFailed')}</p> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. The check before signature, the signature and the filing

function SignStep({ view, t, busy, update, base, submitLines, paper, dict }: StepProps & { submitLines: WizardProps['submitLines']; paper: boolean }) {
  const d = view.draft;
  const [bailiff, setBailiff] = useState(d.designatedBailiffUserId ?? '');
  const [secret, setSecret] = useState('');
  const [depositor, setDepositor] = useState({ name: d.paperDepositor?.name ?? '', idNumber: d.paperDepositor?.idNumber ?? '', quality: d.paperDepositor?.quality ?? '' });
  const [lawyer, setLawyer] = useState(d.paperLawyerUserId ?? '');
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const blocking = view.checks.filter((c) => c.level === 'BLOCKING');
  const warnings = view.checks.filter((c) => c.level === 'WARNING');
  const paid = view.payment.status === 'SUCCEEDED';

  const file = async () => {
    setWorking(true);
    setDialogError(null);
    const changes: Record<string, unknown> = {};
    if ((d.designatedBailiffUserId ?? '') !== bailiff) changes.bailiffUserId = bailiff === '' ? null : bailiff;
    if (paper) {
      changes.paperDepositor = depositor.name.trim() === '' ? null : { name: depositor.name, ...(depositor.idNumber ? { idNumber: depositor.idNumber } : {}), ...(depositor.quality ? { quality: depositor.quality } : {}) };
      changes.paperLawyerUserId = lawyer === '' ? null : lawyer;
    }
    if (Object.keys(changes).length > 0 && !(await update(changes))) {
      setWorking(false);
      setOpen(false);
      return;
    }
    const res = await apiPost<{ caseFileId: string }>(`${base}/submit`, paper ? {} : { secret });
    setWorking(false);
    if (!res.ok) {
      setDialogError(errorText(dict, res.error.messageKey));
      return;
    }
    navigate(`/filings/${d.id}/receipt`);
  };

  return (
    <div>
      <section aria-labelledby="checks-title" className="mb-8">
        <h3 id="checks-title" className="text-lg font-semibold">
          {t('filing.checks.title')}
        </h3>
        <p className="mt-1 text-sm text-text-muted">{t('filing.checks.intro')}</p>
        {view.checks.length === 0 ? <p className="mt-3">{t('filing.checks.none')}</p> : null}
        {blocking.length > 0 ? (
          <>
            <h4 className="mt-4 font-semibold">{t('filing.checks.blocking')}</h4>
            <ul className="mt-2 list-disc space-y-1 ps-6">
              {blocking.map((c, i) => (
                <li key={`${c.code}:${String(i)}`}>{checkText(t, view, c)}</li>
              ))}
            </ul>
          </>
        ) : null}
        {warnings.length > 0 ? (
          <>
            <h4 className="mt-4 font-semibold">{t('filing.checks.warnings')}</h4>
            <ul className="mt-2 list-disc space-y-1 ps-6">
              {warnings.map((c, i) => (
                <li key={`${c.code}:${String(i)}`}>{checkText(t, view, c)}</li>
              ))}
            </ul>
          </>
        ) : null}
        {!paid ? <p className="mt-4 text-elapsed">{t('filing.checks.notPaid')}</p> : null}
      </section>

      <Field id="bailiff" label={t('filing.sign.bailiff')} hint={t('filing.sign.bailiffHint')}>
        <select id="bailiff" className={CONTROL} value={bailiff} onChange={(e) => { setBailiff(e.target.value); }}>
          <option value="">{t('filing.sign.noBailiff')}</option>
          {view.bailiffs.map((b) => (
            <option key={b.userId} value={b.userId}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>

      {paper ? (
        <fieldset className="mb-6 rounded border border-line px-4 py-4">
          <legend className="px-1 font-semibold">{t('filing.paper.depositor')}</legend>
          <LabeledInput id="depositorName" label={t('filing.paper.depositorName')}>
            <input id="depositorName" className={CONTROL} value={depositor.name} onChange={(e) => { setDepositor({ ...depositor, name: e.target.value }); }} />
          </LabeledInput>
          <LabeledInput id="depositorId" label={t('filing.paper.depositorId')}>
            <input id="depositorId" className={CONTROL} value={depositor.idNumber} onChange={(e) => { setDepositor({ ...depositor, idNumber: e.target.value }); }} />
          </LabeledInput>
          <LabeledInput id="depositorQuality" label={t('filing.paper.depositorQuality')}>
            <input id="depositorQuality" className={CONTROL} value={depositor.quality} onChange={(e) => { setDepositor({ ...depositor, quality: e.target.value }); }} />
          </LabeledInput>
          <Field id="paperLawyer" label={t('filing.paper.lawyer')} hint={t('filing.paper.lawyerHint')}>
            <select id="paperLawyer" className={CONTROL} value={lawyer} onChange={(e) => { setLawyer(e.target.value); }}>
              <option value="">{t('filing.paper.noLawyer')}</option>
              {view.lawyers.map((l) => (
                <option key={l.userId} value={l.userId}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>
      ) : (
        <LabeledInput id="signingSecret" label={t('filing.sign.secret')} hint={t('filing.sign.secretHint')}>
          <input id="signingSecret" type="password" autoComplete="off" className={CONTROL} value={secret} onChange={(e) => { setSecret(e.target.value); }} />
        </LabeledInput>
      )}

      <Button
        disabled={busy || working || blocking.length > 0 || !paid || (!paper && secret === '')}
        onClick={() => {
          setDialogError(null);
          setOpen(true);
        }}
      >
        {t(paper ? 'filing.paper.file' : 'filing.sign.file')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        busy={working}
        error={dialogError}
        onConfirm={() => void file()}
        lines={{
          title: t(paper ? 'filing.paper.file' : 'filing.sign.file'),
          effectLabel: t('actions.confirm.effect'),
          effect: submitLines.effect,
          notifiedLabel: t('actions.confirm.notified'),
          notified: submitLines.notified,
          basisLabel: t('actions.confirm.legalBasis'),
          basis: submitLines.basis,
          confirm: t('common.confirm'),
          cancel: t('common.cancel'),
        }}
      />
    </div>
  );
}

export function checkText(t: StepProps['t'], view: DraftView, check: DraftView['checks'][number]): ReactNode {
  const party = check.partyKey ? view.draft.card.parties.find((p) => p.key === check.partyKey) : undefined;
  const document = check.documentId ? view.documents.find((doc) => doc.id === check.documentId) : undefined;
  const subject = party?.name ?? document?.title ?? (check.section ? t(`filing.card.section.${check.section}`) : null);
  const text = t(`filing.check.${check.code}`);
  return (
    <>
      {subject ? `${subject}: ` : ''}
      {text}
      {check.article ? ` (${t('actions.basis.article', { articles: check.article })})` : ''}
      {check.uncertain ? ` — ${t('common.provisionalValue')}` : ''}
    </>
  );
}

export type { CardSection, FilingCard };
