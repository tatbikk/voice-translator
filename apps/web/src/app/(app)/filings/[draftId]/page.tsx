import { ACTIONS, resolveLegalBasis } from '@mahkama/core';
import type { Metadata } from 'next';
import { dictionary } from '@/i18n/dictionary';
import { translator } from '@/i18n/translate';
import { Frame } from '@/components/shell/Frames';
import { legalBasisText } from '@/components/shell/legal-basis-text';
import { FilingWizard } from '@/components/filing/FilingWizard';
import { Notice } from '@/components/ui/Notice';
import { PageHeader } from '@/components/ui/PageHeader';
import { draftResource, draftView, loadDraft } from '@/server/filings/drafts';
import { screenMetadata } from '@/server/page-metadata';
import { requirePage } from '@/server/permissions/guard';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.filings-:draftId');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The messages the six screens read, resolved here for the locale. */
const WIZARD_MESSAGES = ['filing.', 'errors.', 'case.claims.nature.', 'case.nature.', 'case.type.', 'case.amount', 'localities.', 'common.', 'registers.', 'actions.basis.', 'actions.confirm.', 'terms.', 'fees.basis.'];

// «دعوى جديدة»: the six screens of a draft, to its author only (decision 56).
export default async function FilingPage({ params, searchParams }: { params: Promise<{ draftId: string }>; searchParams: Promise<{ step?: string }> }) {
  const context = await requirePage('filing', 'filing.draft.read', async () => {
    const { draftId } = await params;
    return UUID.test(draftId) ? draftResource(draftId) : null;
  });
  const t = translator(context.locale);
  const { draftId } = await params;
  const draft = await loadDraft(draftId);
  if (!draft) return null;
  const { step } = await searchParams;
  const view = await draftView(draft, context.subject);
  const submit = ACTIONS['filing.draft.submit'];
  const filed = view.draft.status === 'FILED';
  return (
    <Frame context={context}>
      <PageHeader title={t('screens.filings-:draftId')} kicker={t(view.draft.channel === 'PAPER' ? 'filing.kicker.paper' : 'filing.kicker.electronic')} />
      {filed ? (
        <Notice tone="info">
          {t('filing.filed')} <a href={`/filings/${view.draft.id}/receipt`}>{t('screens.filings-:draftId-receipt')}</a>
        </Notice>
      ) : (
        <FilingWizard
          initial={view}
          dict={dictionary(context.locale, WIZARD_MESSAGES)}
          initialStep={Math.max(0, Number.parseInt(step ?? '1', 10) - 1) || 0}
          demo={context.mode === 'demo'}
          submitLines={{
            effect: t(view.draft.channel === 'PAPER' ? 'filing.paper.effect' : submit.effectKey),
            notified: t(submit.notifiedKey),
            basis: legalBasisText(t, resolveLegalBasis(submit, undefined)),
          }}
        />
      )}
    </Frame>
  );
}
