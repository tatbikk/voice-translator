import { authorize } from '@mahkama/core';
import type { Metadata } from 'next';
import { dictionary } from '@/i18n/dictionary';
import { translator } from '@/i18n/translate';
import { Frame } from '@/components/shell/Frames';
import { legalBasisText } from '@/components/shell/legal-basis-text';
import { CaseActionButton, type ActKind } from '@/components/case/CaseActionButton';
import { dateTime, dirhams } from '@/components/case/format';
import { NewFilingButton } from '@/components/filing/NewFilingButton';
import { CaseNumber } from '@/components/ui/CaseNumber';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { clock } from '@/server/clock';
import { caseTypesOfCourt, incomingFiles } from '@/server/offices/registry';
import { screenMetadata } from '@/server/page-metadata';
import { requirePage } from '@/server/permissions/guard';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.registry');

const KINDS: Readonly<Record<string, ActKind>> = {
  'case.registration.stamp': 'plain',
  'case.registration.reclassify': 'reclassify',
  'case.registration.note-to-judge': 'note',
};

// «مكتب التقييد» (study, «واجهة كتابة الضبط»): «الملفات الواردة», each with its
// «بطاقة الدعوى» and three buttons — «تأشير» «تصحيح التصنيف» «ملاحظة إلى
// القاضي» — and no button to reject the application (study, «الأصل القبول»).
// «إيداع ورقي» records an application deposited at the office.
export default async function RegistryPage() {
  const context = await requirePage('registry', 'registry.incoming.list');
  const t = translator(context.locale);
  const now = clock.now();
  const authContext = { mode: context.mode, demoToolsEnabled: context.demoToolsEnabled, now };
  const [files, types] = await Promise.all([incomingFiles(context.subject, authContext), caseTypesOfCourt(context.subject.courtId ?? null, now)]);
  const canFilePaper = authorize(context.subject, 'filing.paper', { kind: 'new-filing' }, authContext).allowed;
  const dict = dictionary(context.locale, ['errors.', 'common.', 'filing.choose', 'filing.court.caseTypeOption', 'registry.']);
  const caseTypes = types.map((c) => ({ code: c.code, name: t(`case.type.${c.code}`) }));
  const numberLabel = t('common.caseNumberLabel');
  return (
    <Frame context={context}>
      <PageHeader title={t('screens.registry')}>
        <p className="mt-2 max-w-3xl text-text-muted">{t('registry.intro')}</p>
      </PageHeader>
      {canFilePaper ? (
        <div className="mb-8">
          <NewFilingButton path="/api/v1/filings/paper" label={t('registry.paperFiling')} dict={dict} variant="secondary" />
        </div>
      ) : null}
      <section aria-labelledby="incoming-title">
        <h2 id="incoming-title" className="mb-4 text-2xl">
          {t('registry.incoming')}
        </h2>
        {files.length === 0 ? <EmptyState text={t('registry.empty')} /> : null}
        <div className="space-y-6">
          {files.map((f) => (
            <article key={f.caseFileId} aria-labelledby={`file-${f.caseFileId}`} className="card px-5 py-5">
              <h3 id={`file-${f.caseFileId}`} className="text-xl">
                <CaseNumber value={f.number} labelTemplate={numberLabel} />
              </h3>
              <p className="mt-1 text-sm text-text-muted">
                {f.caseType ? t(`case.type.${f.caseType}`) : t('case.type.unknown')} — {t(`case.channel.${f.channel ?? 'ELECTRONIC'}`)}
                {f.registeredAt ? ` — ${dateTime(t, f.registeredAt)}` : ''}
              </p>
              <h4 className="mt-4 font-semibold">{t('filing.caseCard')}</h4>
              <dl className="mt-2 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="text-text-muted">{t('filing.card.summary')}</dt>
                  <dd className="whitespace-pre-line">{f.subject ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-text-muted">{t('registry.card.plaintiffs')}</dt>
                  <dd>{f.parties.filter((p) => p.side === 'PLAINTIFF').map((p) => p.name).join(t('filing.listSeparator')) || '—'}</dd>
                </div>
                <div>
                  <dt className="text-text-muted">{t('registry.card.defendants')}</dt>
                  <dd>{f.parties.filter((p) => p.side !== 'PLAINTIFF').map((p) => p.name).join(t('filing.listSeparator')) || '—'}</dd>
                </div>
                <div>
                  <dt className="text-text-muted">{t('registry.card.claims')}</dt>
                  <dd>
                    {f.claims.map((c) => (c.amountCents === null ? t(`case.claims.nature.${c.nature}`) : `${t(`case.claims.nature.${c.nature}`)} (${dirhams(t, c.amountCents)})`)).join(t('filing.listSeparator')) || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted">{t('registry.card.fee')}</dt>
                  <dd>
                    {dirhams(t, f.feePaidCents)}
                    {f.feeAssessedCents !== null && f.feeAssessedCents !== f.feePaidCents ? ` — ${t('registry.card.feeMismatch', { amount: dirhams(t, f.feeAssessedCents) })}` : ''}
                  </dd>
                </div>
              </dl>
              <div className="mt-5 flex flex-wrap gap-3">
                {f.actions
                  .filter((a) => KINDS[a.code] !== undefined)
                  .map((a) => (
                    <CaseActionButton
                      key={a.code}
                      caseFileId={f.caseFileId}
                      code={a.code}
                      kind={KINDS[a.code] ?? 'plain'}
                      label={t(a.labelKey)}
                      dict={dict}
                      caseTypes={caseTypes}
                      currentCaseType={f.caseType}
                      after="/registry"
                      lines={{
                        effectLabel: t('actions.confirm.effect'),
                        effect: t(a.effectKey),
                        notifiedLabel: t('actions.confirm.notified'),
                        notified: t(a.notifiedKey),
                        basisLabel: t('actions.confirm.legalBasis'),
                        basis: legalBasisText(t, a.basis),
                      }}
                    />
                  ))}
              </div>
              <p className="mt-4 text-sm">
                <a href={`/cases/${f.caseFileId}`}>{t('registry.openCase')}</a>
              </p>
            </article>
          ))}
        </div>
      </section>
    </Frame>
  );
}
