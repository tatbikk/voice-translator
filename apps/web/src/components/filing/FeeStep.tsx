'use client';

import { useState } from 'react';
import { formatMoroccoDate } from '@mahkama/core';
import { apiPost, navigate } from '@/components/client/api';
import { errorText, money } from '@/components/client/messages';
import { Button } from '@/components/ui/Button';
import { CONTROL, LabeledInput, type StepProps } from './parts';

// 5. «الرسم القضائي»: computed by the platform from the claims (rule 5 of the
// prompt), detailed with its basis, marked «قيمة مؤقتة غير مؤكدة» while a
// rate, the way the rates apply or the fee of a claim without a fixed amount is
// an open question, and paid through the gateway. A claim without a fixed
// amount that the table does not put outside the base has a line of its own.
// The amount is never sent by the browser. A rate is written with the decimal
// comma, the dot being the thousands separator of the platform (glossary,
// rule 7; review P2-L-20).

export function FeeStep({ view, dict, t, busy, update }: StepProps) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fee = view.fee;
  const paper = view.draft.channel === 'PAPER';
  const paid = view.payment.status === 'SUCCEEDED';
  const d = view.draft;
  // On paper, the depositor pays at the counter and the receipt names him: he is recorded before payment.
  const [depositor, setDepositor] = useState({ name: d.paperDepositor?.name ?? '', idNumber: d.paperDepositor?.idNumber ?? '', quality: d.paperDepositor?.quality ?? '' });
  const depositorMissing = paper && view.checks.some((c) => c.code === 'PAPER_DEPOSITOR_MISSING');
  const saveDepositor = () =>
    update({
      paperDepositor:
        depositor.name.trim() === ''
          ? null
          : { name: depositor.name, ...(depositor.idNumber ? { idNumber: depositor.idNumber } : {}), ...(depositor.quality ? { quality: depositor.quality } : {}) },
    });

  const pay = async () => {
    setOpening(true);
    setError(null);
    const res = await apiPost<{ intentId: string }>(`/api/v1/filings/${view.draft.id}/payment`, {});
    setOpening(false);
    if (!res.ok) {
      setError(errorText(dict, res.error.messageKey));
      return;
    }
    navigate(`/payments/${res.data.intentId}`);
  };

  if (!fee) return <p>{t('filing.fee.unavailable')}</p>;
  return (
    <div>
      <p className="mb-5 text-text-muted">{t('filing.fee.intro')}</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-start">
          <caption className="sr-only">{t('filing.fee.caption')}</caption>
          <thead>
            <tr className="border-b border-line-strong">
              <th scope="col" className="px-2 py-2 text-start">{t('filing.fee.columns.line')}</th>
              <th scope="col" className="px-2 py-2 text-start">{t('filing.fee.columns.base')}</th>
              <th scope="col" className="px-2 py-2 text-start">{t('filing.fee.columns.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {fee.lines.map((line, i) => (
              <tr key={`${line.kind}:${String(i)}`} className="border-b border-line">
                <th scope="row" className="px-2 py-2 text-start font-normal">
                  {t(line.basis, line.claimNature ? { claim: t(`case.claims.nature.${line.claimNature}`) } : {})}
                  {line.rateBasisPoints !== null ? ` (${t('filing.fee.rate', { rate: (line.rateBasisPoints / 100).toString().replace('.', ',') })})` : ''}
                  {line.uncertain ? <span className="block text-sm text-elapsed">{t('common.provisionalValue')}</span> : null}
                </th>
                <td className="px-2 py-2">{line.baseCents === null ? '—' : money(dict, line.baseCents)}</td>
                <td className="px-2 py-2">{money(dict, line.amountCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="px-2 py-3 text-start">{t('filing.fee.total')}</th>
              <td />
              <td className="px-2 py-3 font-semibold">{money(dict, fee.totalCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {fee.uncertain ? <p className="mt-3 text-elapsed">{t('common.provisionalValue')}: {t('filing.fee.uncertainWhy')}</p> : null}
      {fee.excluded.length > 0 ? (
        <p className="mt-3 text-sm text-text-muted">
          {t('filing.fee.excluded', { claims: fee.excluded.map((n) => t(`case.claims.nature.${n}`)).join(t('filing.listSeparator')) })}
        </p>
      ) : null}
      <p className="mt-3 text-sm text-text-muted">{t('filing.fee.rules', { date: formatMoroccoDate(new Date(`${fee.validFrom}T12:00:00Z`)) })}</p>
      <p className="mt-1 text-sm text-text-muted">{t('filing.fee.source')}</p>
      <p className="mt-3">{t(paper ? 'filing.fee.methodCounter' : 'filing.fee.methodOnline')}</p>

      <div className="mt-6">
        {paid ? (
          <p>
            {t('filing.fee.paid', { ref: view.payment.operationRef ?? '' })}
          </p>
        ) : (
          <>
            {view.payment.status === 'FAILED' || view.payment.status === 'CANCELLED' || view.payment.status === 'EXPIRED' ? (
              <p className="mb-3 text-elapsed">{t(`filing.fee.status.${view.payment.status}`)}</p>
            ) : null}
            {paper ? (
              <fieldset className="mb-5 rounded border border-line px-4 py-4">
                <legend className="px-1 font-semibold">{t('filing.paper.depositor')}</legend>
                <p className="mb-3 text-sm text-text-muted">{t('filing.paper.depositorBeforePayment')}</p>
                <LabeledInput id="feeDepositorName" label={t('filing.paper.depositorName')}>
                  <input id="feeDepositorName" className={CONTROL} value={depositor.name} onChange={(e) => { setDepositor({ ...depositor, name: e.target.value }); }} />
                </LabeledInput>
                <LabeledInput id="feeDepositorId" label={t('filing.paper.depositorId')}>
                  <input id="feeDepositorId" className={CONTROL} value={depositor.idNumber} onChange={(e) => { setDepositor({ ...depositor, idNumber: e.target.value }); }} />
                </LabeledInput>
                <LabeledInput id="feeDepositorQuality" label={t('filing.paper.depositorQuality')}>
                  <input id="feeDepositorQuality" className={CONTROL} value={depositor.quality} onChange={(e) => { setDepositor({ ...depositor, quality: e.target.value }); }} />
                </LabeledInput>
                <Button variant="secondary" disabled={busy} onClick={() => void saveDepositor()}>
                  {t('filing.save')}
                </Button>
              </fieldset>
            ) : null}
            <Button disabled={busy || opening || depositorMissing} onClick={() => void pay()}>
              {t('filing.fee.pay')}
            </Button>
          </>
        )}
        <p aria-live="polite" className={error ? 'mt-3 text-elapsed' : 'sr-only'}>
          {error ?? ''}
        </p>
      </div>
    </div>
  );
}
