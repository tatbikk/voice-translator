import { formatMoroccoDate, roleLabelKey, statusLabelKey, type RoleCode } from '@mahkama/core';
import type { Metadata } from 'next';
import { translator, type Translator } from '@/i18n/translate';
import { CaseNumber } from '@/components/ui/CaseNumber';
import { DeadlineCounter, type DeadlineState } from '@/components/ui/DeadlineCounter';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProvisionalMark } from '@/components/ui/ProvisionalMark';
import { TABLE } from '@/components/ui/table-style';
import { TableFrame } from '@/components/ui/TableFrame';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { Frame } from '@/components/shell/Frames';
import { VerifySignatures } from '@/components/case/VerifySignatures';
import { dateTime, dirhams, longDay } from '@/components/case/format';
import { CaseActionButton, type ActKind } from '@/components/case/CaseActionButton';
import { dictionary } from '@/i18n/dictionary';
import { actionViews } from '@/server/cases/actions-view';
import { executorKind } from '@/server/cases/executors';
import { caseTypesOfCourt } from '@/server/offices/registry';
import { caseResource } from '@/server/cases/resources';
import { caseView, type CaseView } from '@/server/cases/view';
import { clock } from '@/server/clock';
import { requirePage } from '@/server/permissions/guard';
import { screenMetadata } from '@/server/page-metadata';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.case');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const APPROACHING_MS = 3 * 86_400_000;

/** The acts executed from the action bar (Phase 2), by the fields their window asks for. */
const ACT_KINDS: Readonly<Record<string, ActKind>> = {
  'case.registration.stamp': 'plain',
  'case.registration.reclassify': 'reclassify',
  'case.registration.note-to-judge': 'note',
  'case.prosecution.conclusions': 'upload',
  'case.commissioner.opinion': 'upload',
};

// «صفحة الملف» (interface book, «العناصر المشتركة»): the header, the eight
// tabs, read-only in Phase 1, and beside them the actions the subject's role
// may take in the file's state, each with the three lines of its confirmation
// window. Everything shown was filtered on the server for this subject.
export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const context = await requirePage('case', 'case.view', async () => {
    const { caseId } = await params;
    return UUID.test(caseId) ? caseResource(caseId, clock.now()) : null;
  });
  const t = translator(context.locale);
  const resource = context.resource;
  if (resource?.kind !== 'case') return null;
  const view = await caseView(resource.snapshot.caseFileId, context.subject, resource.snapshot);
  if (!view) return null;
  const actions = actionViews(t, context.subject, resource, { mode: context.mode, demoToolsEnabled: context.demoToolsEnabled, now: clock.now() });
  const h = view.header;
  const numberLabel = t('common.caseNumberLabel');
  const actDict = dictionary(context.locale, ['errors.', 'common.', 'filing.choose', 'filing.court.caseTypeOption', 'registry.', 'case.act.']);
  const caseTypes = actions.some((a) => ACT_KINDS[a.code] === 'reclassify')
    ? (await caseTypesOfCourt(resource.snapshot.courtId, clock.now())).map((c) => ({ code: c.code, name: t(`case.type.${c.code}`) }))
    : [];

  const tabs: TabItem[] = [
    { id: 'timeline', label: t('case.tabs.timeline'), content: <Timeline t={t} view={view} courtDegree={h.courtDegree} /> },
    { id: 'documents', label: t('case.tabs.documents'), content: <Documents t={t} view={view} /> },
    { id: 'parties', label: t('case.tabs.parties'), content: <Parties t={t} view={view} /> },
    { id: 'claims', label: t('case.tabs.claims'), content: <Claims t={t} view={view} /> },
    { id: 'services', label: t('case.tabs.services'), content: <Services t={t} view={view} /> },
    { id: 'deadlines', label: t('case.tabs.deadlines'), content: <Deadlines t={t} view={view} now={clock.now()} /> },
    { id: 'payments', label: t('case.tabs.payments'), content: <Payments t={t} view={view} /> },
    { id: 'decisions', label: t('case.tabs.decisions'), content: <Decisions t={t} view={view} /> },
  ];

  return (
    <Frame context={context}>
      <PageHeader title={t('screens.cases-:caseId')} kicker={t(`case.kind.${h.kind}`)}>
        <dl className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={t('case.header.number')}>
            <CaseNumber value={h.number} labelTemplate={numberLabel} />
          </Fact>
          <Fact label={t('case.header.nationalRef')}>
            <bdi className="ltr-run" dir="ltr">{h.nationalRef}</bdi>
          </Fact>
          <Fact label={t('case.header.court')}>{h.courtName}</Fact>
          <Fact label={t('case.header.panel')}>{h.panelName ?? '—'}</Fact>
          <Fact label={t('case.header.type')}>{h.caseType ? t(`case.type.${h.caseType}`) : t('case.type.unknown')}</Fact>
          <Fact label={t('case.header.status')}>
            {/* The study's wording for a file just registered: «مقيد، في انتظار تعيين القاضي المقرر». */}
            <strong>{h.status === 'REGISTERED' && h.rapporteurName === null ? t('case.status.awaitingRapporteur') : t(statusLabelKey(h.status as Parameters<typeof statusLabelKey>[0]))}</strong>
          </Fact>
          <Fact label={t('case.header.nextHearing')}>{h.nextHearing ? dateTime(t, h.nextHearing) : t('case.header.noHearing')}</Fact>
          <Fact label={t('case.header.rapporteur')}>{h.rapporteurName ?? t('case.header.noRapporteur')}</Fact>
        </dl>
      </PageHeader>
      {view.notes.length > 0 ? (
        <section aria-labelledby="notes-title" className="card mb-8 px-5 py-5">
          <h2 id="notes-title" className="text-xl">{t('case.notes.title')}</h2>
          <ul className="mt-3 space-y-3">
            {view.notes.map((n) => (
              <li key={n.id} className="border-t border-line pt-3">
                <p className="text-sm text-text-muted">
                  {t(`registry.note.reasons.${n.reason}`)} — {dateTime(t, n.createdAt)}
                </p>
                <p className="mt-1 whitespace-pre-line">{n.text}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <Tabs items={tabs} label={t('case.tabs.label')} />
        </div>
        <aside aria-labelledby="actions-title" className="card h-fit px-5 py-5">
          <h2 id="actions-title" className="text-xl">{t('case.actions.title')}</h2>
          <p className="mt-2 text-sm text-text-muted">{t('case.actions.intro')}</p>
          {actions.length === 0 ? (
            <p className="mt-4">{t('case.actions.empty')}</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {actions.map((a) => (
                <li key={a.code} className="border-t border-line pt-3">
                  {ACT_KINDS[a.code] && executorKind(a.code) ? (
                    <CaseActionButton
                      caseFileId={resource.snapshot.caseFileId}
                      code={a.code}
                      kind={ACT_KINDS[a.code] ?? 'plain'}
                      label={a.label}
                      dict={actDict}
                      caseTypes={caseTypes}
                      currentCaseType={h.caseType}
                      lines={{
                        effectLabel: t('actions.confirm.effect'),
                        effect: a.effect,
                        notifiedLabel: t('actions.confirm.notified'),
                        notified: a.notified,
                        basisLabel: t('actions.confirm.legalBasis'),
                        basis: a.legalBasis,
                      }}
                    />
                  ) : (
                  <details>
                    <summary className="cursor-pointer font-semibold">{a.label}</summary>
                    <dl className="mt-2 space-y-1.5 text-sm">
                      {a.effect ? (
                        <div>
                          <dt className="font-semibold">{t('actions.confirm.effect')}</dt>
                          <dd>{a.effect}</dd>
                        </div>
                      ) : (
                        <div>
                          <dd>{t('case.actions.access')}</dd>
                        </div>
                      )}
                      {a.notified ? (
                        <div>
                          <dt className="font-semibold">{t('actions.confirm.notified')}</dt>
                          <dd>{a.notified}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt className="font-semibold">{t('actions.confirm.legalBasis')}</dt>
                        <dd>{a.legalBasis}</dd>
                      </div>
                      {a.signature ? <dd className="text-text-muted">{t('case.actions.signature')}</dd> : null}
                      {a.awaited ? <dd className="text-text-muted">{t('case.actions.awaited')}</dd> : null}
                    </dl>
                  </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </Frame>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <EmptyState text={text} />;
}

function Timeline({ t, view, courtDegree }: { t: Translator; view: CaseView; courtDegree: 'FIRST_INSTANCE' | 'APPEAL' }) {
  if (view.timeline.length === 0) return <Empty text={t('case.timeline.empty')} />;
  return (
    <TableFrame label={t('case.tabs.timeline')}>
      <table className={TABLE.table}>
        <caption className="sr-only">{t('case.tabs.timeline')}</caption>
        <thead>
          <tr className={TABLE.headRow}>
            <th scope="col" className={TABLE.th}>{t('case.timeline.columns.date')}</th>
            <th scope="col" className={TABLE.th}>{t('case.timeline.columns.act')}</th>
            <th scope="col" className={TABLE.th}>{t('case.timeline.columns.by')}</th>
            <th scope="col" className={TABLE.th}>{t('case.timeline.columns.basis')}</th>
          </tr>
        </thead>
        <tbody>
          {view.timeline.map((e) => (
            <tr key={e.seq} className={TABLE.row}>
              <td className={TABLE.td}>{dateTime(t, e.occurredAt)}</td>
              <th scope="row" className={TABLE.rowHeader}>{e.referrals === 0 ? t('case.timeline.event.case.referrals.none') : timelineLabel(t, e.action, e.detailAction)}</th>
              <td className={TABLE.td}>{e.actorRole ? t(roleLabelKey(e.actorRole as RoleCode, courtDegree)) : t('case.timeline.system')}</td>
              <td className={TABLE.td}>{e.articles.length > 0 ? basisText(t, e.articles) : t('case.timeline.noBasis')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

function timelineLabel(t: Translator, action: string, detailAction: string | null): string {
  if (action === 'case.transition.recorded' && detailAction) return t(`actions.${detailAction}.label`);
  const key = `case.timeline.event.${action}`;
  const text = t(key);
  return text === key ? t('case.timeline.event.other') : text;
}

function basisText(t: Translator, articles: readonly number[]): string {
  const list = articles.join(t('actions.basis.articleSeparator'));
  const key = articles.length === 1 ? 'actions.basis.article' : articles.length === 2 ? 'actions.basis.articles.two' : 'actions.basis.articles.many';
  return t(key, { articles: list });
}

function Documents({ t, view }: { t: Translator; view: CaseView }) {
  if (view.documents.length === 0) return <Empty text={t('case.documents.empty')} />;
  const verifyLabels = {
    button: t('case.documents.verify.button'),
    checking: t('case.documents.verify.checking'),
    valid: t('case.documents.verify.valid'),
    changed: t('case.documents.verify.changed'),
    invalid: t('case.documents.verify.invalid'),
    none: t('case.documents.verify.none'),
    failed: t('case.documents.verify.failed'),
  };
  // «شهادة توقيع» comes right after the document it attests, and names it (decision 72).
  const titleOf = (d: CaseView['documents'][number]) => d.title ?? t(`case.docType.${d.docType}`);
  const attested = (d: CaseView['documents'][number]) => {
    const target = d.attestsDocumentId ? view.documents.find((o) => o.id === d.attestsDocumentId) : undefined;
    return target ? titleOf(target) : null;
  };
  return (
    <TableFrame label={t('case.tabs.documents')}>
      <table className={TABLE.table}>
        <caption className="sr-only">{t('case.tabs.documents')}</caption>
        <thead>
          <tr className={TABLE.headRow}>
            <th scope="col" className={TABLE.th}>{t('case.documents.columns.document')}</th>
            <th scope="col" className={TABLE.th}>{t('case.documents.columns.nature')}</th>
            <th scope="col" className={TABLE.th}>{t('case.documents.columns.channel')}</th>
            <th scope="col" className={TABLE.th}>{t('case.documents.columns.depositor')}</th>
            <th scope="col" className={TABLE.th}>{t('case.documents.columns.date')}</th>
            <th scope="col" className={TABLE.th}>{t('case.documents.columns.signatures')}</th>
            <th scope="col" className={TABLE.th}>{t('case.documents.columns.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {view.documents.map((d) => (
            <tr key={d.id} className={TABLE.row}>
              <th scope="row" className={TABLE.rowHeader}>
                {titleOf(d)}
                {d.withdrawn ? <p className="mt-1 font-normal text-text-muted">{t('case.documents.withdrawn')}</p> : null}
                {attested(d) ? <p className="mt-1 font-normal text-text-muted">{t('case.documents.attests', { document: attested(d) ?? '' })}</p> : null}
              </th>
              <td className={TABLE.td}>{d.declaredNature ? t(`case.nature.${d.declaredNature}`) : t('case.nature.none')}</td>
              <td className={TABLE.td}>{t(`case.channel.${d.channel}`)}</td>
              <td className={TABLE.td}>{d.generated ? t('case.documents.generated') : (d.depositor ?? '—')}</td>
              <td className={TABLE.td}>{dateTime(t, d.depositedAt)}</td>
              <td className={TABLE.td}>
                {d.signatures === 0 ? (
                  t('case.documents.noSignature')
                ) : (
                  <>
                    {t('case.documents.signatures', { count: d.signatures })}
                    {d.simulated || d.simulatedSignature ? <span className="ms-2 border border-line-strong px-1.5 text-sm">{t('case.documents.simulatedStamp')}</span> : null}
                  </>
                )}
              </td>
              <td className={TABLE.td}>
                <a href={`/api/v1/cases/${view.header.id}/documents/${d.id}/file`}>{t('case.documents.download')}</a>
                {d.signatures > 0 ? (
                  <div className="mt-2">
                    <VerifySignatures caseId={view.header.id} documentId={d.id} labels={verifyLabels} />
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

function Parties({ t, view }: { t: Translator; view: CaseView }) {
  if (view.parties.length === 0) return <Empty text={t('case.parties.empty')} />;
  return (
    <ul className="space-y-4">
      {view.parties.map((p) => (
        <li key={p.id} className="card px-5 py-4">
          <h3 className="text-lg">
            {p.displayName} <span className="text-base font-normal text-text-muted">— {t(`case.parties.side.${p.side}`)}</span>
          </h3>
          <dl className="mt-2 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
            {p.quality ? <Fact label={t('case.parties.quality')}>{p.quality}</Fact> : null}
            <Fact label={t('case.parties.kind.' + p.personKind)}>{p.legalForm ?? '—'}</Fact>
            {p.legalRepresentative ? <Fact label={t('case.parties.representative')}>{p.legalRepresentative}</Fact> : null}
            <Fact label={t('case.parties.counsel')}>{p.counsel.length > 0 ? p.counsel.join(t('actions.basis.articleSeparator')) : t('case.parties.noCounsel')}</Fact>
            <Fact label={t('case.parties.addresses')}>
              <ul>
                {p.addresses.map((a, i) => (
                  <li key={i}>
                    {t(`case.parties.address.${a.kind}`)}: {a.value} ({t(`case.parties.source.${a.source}`)})
                  </li>
                ))}
              </ul>
            </Fact>
          </dl>
          <p className="mt-2 text-sm">
            {p.eServiceAcceptedAt ? t('case.parties.eService.accepted', { date: formatMoroccoDate(p.eServiceAcceptedAt) }) : t('case.parties.eService.not')}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Claims({ t, view }: { t: Translator; view: CaseView }) {
  return (
    <div className="space-y-6">
      {(['PRINCIPAL', 'COUNTER', 'INCIDENTAL'] as const).map((category) => {
        const claims = view.claims.filter((c) => c.category === category);
        return (
          <section key={category} aria-labelledby={`claims-${category}`}>
            <h3 id={`claims-${category}`} className="mb-2 text-lg">{t(`case.claims.category.${category}`)}</h3>
            {claims.length === 0 ? (
              <Empty text={t('case.claims.empty')} />
            ) : (
              <TableFrame label={t(`case.claims.category.${category}`)}>
                <table className={TABLE.table}>
                  <thead>
                    <tr className={TABLE.headRow}>
                      <th scope="col" className={TABLE.th}>{t('case.claims.columns.nature')}</th>
                      <th scope="col" className={TABLE.th}>{t('case.claims.columns.amount')}</th>
                      <th scope="col" className={TABLE.th}>{t('case.claims.columns.party')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map((c) => (
                      <tr key={c.id} className={TABLE.row}>
                        <th scope="row" className={TABLE.rowHeader}>{t(`case.claims.nature.${c.nature}`)}</th>
                        <td className={TABLE.td}>{c.amountCents === null ? t('case.claims.noAmount') : dirhams(t, c.amountCents)}</td>
                        <td className={TABLE.td}>{c.party ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Services({ t, view }: { t: Translator; view: CaseView }) {
  if (view.services.length === 0) return <Empty text={t('case.services.empty')} />;
  return (
    <TableFrame label={t('case.tabs.services')}>
      <table className={TABLE.table}>
        <caption className="sr-only">{t('case.tabs.services')}</caption>
        <thead>
          <tr className={TABLE.headRow}>
            <th scope="col" className={TABLE.th}>{t('case.services.columns.party')}</th>
            <th scope="col" className={TABLE.th}>{t('case.services.columns.purpose')}</th>
            <th scope="col" className={TABLE.th}>{t('case.services.columns.channel')}</th>
            <th scope="col" className={TABLE.th}>{t('case.services.columns.status')}</th>
            <th scope="col" className={TABLE.th}>{t('case.services.columns.date')}</th>
            <th scope="col" className={TABLE.th}>{t('case.services.columns.proof')}</th>
          </tr>
        </thead>
        <tbody>
          {view.services.map((s) => (
            <tr key={s.id} className={TABLE.row}>
              <th scope="row" className={TABLE.rowHeader}>{s.party}</th>
              <td className={TABLE.td}>{t(`case.services.purpose.${s.purpose}`)}</td>
              <td className={TABLE.td}>{t(`case.services.channel.${s.channel}`)}</td>
              <td className={TABLE.td}>{t(`case.services.status.${s.status}`)}</td>
              <td className={TABLE.td}>
                {s.servedAt ? dateTime(t, s.servedAt) : s.dispatchedAt ? dateTime(t, s.dispatchedAt) : '—'}
                {s.deemedServedAt ? <p className="mt-1 text-sm">{t('case.services.deemed', { date: formatMoroccoDate(s.deemedServedAt) })}</p> : null}
              </td>
              <td className={TABLE.td}>{s.proof ? t(`case.services.proof.${s.proof}`) : t('case.services.proof.none')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

function deadlineState(status: string, endsAt: Date, now: Date): { state: DeadlineState; key: string } {
  if (status === 'MET') return { state: 'running', key: 'met' };
  if (status === 'CLOSED') return { state: 'running', key: 'closed' };
  if (status === 'ELAPSED' || endsAt.getTime() <= now.getTime()) return { state: 'elapsed', key: 'elapsed' };
  if (endsAt.getTime() - now.getTime() <= APPROACHING_MS) return { state: 'approaching', key: 'approaching' };
  return { state: 'running', key: 'running' };
}

function Deadlines({ t, view, now }: { t: Translator; view: CaseView; now: Date }) {
  if (view.deadlines.length === 0) return <Empty text={t('case.deadlines.empty')} />;
  return (
    <TableFrame label={t('case.tabs.deadlines')}>
      <table className={TABLE.table}>
        <caption className="sr-only">{t('case.tabs.deadlines')}</caption>
        <thead>
          <tr className={TABLE.headRow}>
            <th scope="col" className={TABLE.th}>{t('case.deadlines.columns.deadline')}</th>
            <th scope="col" className={TABLE.th}>{t('case.deadlines.columns.party')}</th>
            <th scope="col" className={TABLE.th}>{t('case.deadlines.columns.start')}</th>
            <th scope="col" className={TABLE.th}>{t('case.deadlines.columns.state')}</th>
          </tr>
        </thead>
        <tbody>
          {view.deadlines.map((d) => {
            const { state, key } = deadlineState(d.status, d.endsAt, now);
            return (
              <tr key={d.id} className={TABLE.row}>
                <th scope="row" className={TABLE.rowHeader}>
                  {t(`case.deadlines.rule.${d.ruleCode}`)}
                  {d.articles.length > 0 ? <p className="mt-1 font-normal text-text-muted">{basisText(t, d.articles)}</p> : null}
                  {d.uncertain ? <p className="mt-1 font-normal text-approaching">{t('case.deadlines.uncertain')}</p> : null}
                </th>
                <td className={TABLE.td}>{d.party ?? t('case.deadlines.file')}</td>
                <td className={TABLE.td}>{dateTime(t, d.startsAt)}</td>
                <td className={TABLE.td}>
                  <DeadlineCounter
                    state={state}
                    stateLabel={t(`case.deadlines.state.${key}`)}
                    untilText={key === 'elapsed' ? t('case.deadlines.elapsedOn', { date: longDay(d.lastDay) }) : t('case.deadlines.until', { date: longDay(d.lastDay) })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableFrame>
  );
}

function Payments({ t, view }: { t: Translator; view: CaseView }) {
  const { fees, payments, treasury } = view.payments;
  return (
    <div className="space-y-6">
      <section aria-labelledby="fees-title">
        <h3 id="fees-title" className="mb-2 text-lg">{t('case.payments.fees')}</h3>
        {fees.length === 0 ? (
          <Empty text={t('case.payments.empty')} />
        ) : (
          <ul className="space-y-1">
            {fees.map((f) => (
              <li key={f.id}>
                {t(`case.payments.filing.${f.filing}`)}: <strong>{dirhams(t, f.totalCents)}</strong> — {dateTime(t, f.assessedAt)}
                {f.uncertain ? <span className="ms-2 text-approaching">{t('case.deadlines.uncertain')}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="payments-title">
        <h3 id="payments-title" className="mb-2 text-lg">{t('case.payments.payments')}</h3>
        {payments.length === 0 ? (
          <Empty text={t('case.payments.empty')} />
        ) : (
          <TableFrame label={t('case.payments.payments')}>
            <table className={TABLE.table}>
              <thead>
                <tr className={TABLE.headRow}>
                  <th scope="col" className={TABLE.th}>{t('case.payments.columns.purpose')}</th>
                  <th scope="col" className={TABLE.th}>{t('case.payments.columns.amount')}</th>
                  <th scope="col" className={TABLE.th}>{t('case.payments.columns.status')}</th>
                  <th scope="col" className={TABLE.th}>{t('case.payments.columns.reference')}</th>
                  <th scope="col" className={TABLE.th}>{t('case.payments.columns.date')}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className={TABLE.row}>
                    <th scope="row" className={TABLE.rowHeader}>{t(`case.payments.purpose.${p.purpose}`)}</th>
                    <td className={TABLE.td}>
                      {dirhams(t, p.amountCents)}
                      {p.uncertain ? <ProvisionalMark text={t('common.provisionalValue')} /> : null}
                    </td>
                    <td className={TABLE.td}>{t(`case.payments.status.${p.status}`)}</td>
                    <td className={TABLE.td}>
                      <bdi dir="ltr">{p.operationRef}</bdi>
                    </td>
                    <td className={TABLE.td}>{dateTime(t, p.paidAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
      </section>
      <section aria-labelledby="treasury-title">
        <h3 id="treasury-title" className="mb-2 text-lg">{t('case.payments.treasury')}</h3>
        {treasury.length === 0 ? (
          <Empty text={t('case.payments.empty')} />
        ) : (
          <ul className="space-y-1">
            {treasury.map((e) => (
              <li key={e.id}>
                {t(`case.payments.direction.${e.direction}`)} — {t(`case.payments.purpose.${e.purpose}`)}: <strong>{dirhams(t, e.amountCents)}</strong>
                {e.uncertain ? <ProvisionalMark text={t('common.provisionalValue')} /> : null} — {dateTime(t, e.at)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Decisions({ t, view }: { t: Translator; view: CaseView }) {
  if (view.decisions.length === 0) return <Empty text={t('case.decisions.empty')} />;
  return (
    <TableFrame label={t('case.tabs.decisions')}>
      <table className={TABLE.table}>
        <caption className="sr-only">{t('case.tabs.decisions')}</caption>
        <thead>
          <tr className={TABLE.headRow}>
            <th scope="col" className={TABLE.th}>{t('case.decisions.columns.decision')}</th>
            <th scope="col" className={TABLE.th}>{t('case.decisions.columns.issued')}</th>
            <th scope="col" className={TABLE.th}>{t('case.decisions.columns.pronounced')}</th>
            <th scope="col" className={TABLE.th}>{t('case.decisions.columns.final')}</th>
          </tr>
        </thead>
        <tbody>
          {view.decisions.map((d) => (
            <tr key={d.id} className={TABLE.row}>
              <th scope="row" className={TABLE.rowHeader}>
                {t(`case.decisions.kind.${d.kind}`)} — {t(`case.decisions.subject.${d.subjectCode}`)}
              </th>
              <td className={TABLE.td}>{dateTime(t, d.issuedAt)}</td>
              <td className={TABLE.td}>{d.pronouncedAt ? dateTime(t, d.pronouncedAt) : t('case.decisions.notPronounced')}</td>
              <td className={TABLE.td}>{d.final ? t('case.decisions.final') : t('case.decisions.notFinal')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}
