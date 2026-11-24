import { notFound } from 'next/navigation';
import { translator } from '@/i18n/translate';
import { PageHeader } from '@/components/ui/PageHeader';
import { Frame } from '@/components/shell/Frames';
import { replaceableComponents } from '@/server/components/registry';
import { requireGate } from '@/server/permissions/guard';
import { chainStatus } from '@/server/events/status';
import type { Metadata } from 'next';
import { screenMetadata } from '@/server/page-metadata';
import { TABLE } from '@/components/ui/table-style';
import { TableFrame } from '@/components/ui/TableFrame';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.environment');

// «مكونات بيئة العرض»: opened from the quiet indicator of the top bar; exists
// only in the demo environment.
export default async function EnvironmentPage() {
  const context = await requireGate('environment');
  if (context.mode !== 'demo') notFound();
  const t = translator(context.locale);
  const components = replaceableComponents();
  const status = await chainStatus();
  return (
    <Frame context={context}>
      <PageHeader title={t('screens.environment')} intro={t('environment.intro')} />
      <TableFrame label={t('screens.environment')}>
        <table className={TABLE.table}>
          <caption className="sr-only">{t('screens.environment')}</caption>
          <thead>
            <tr className={TABLE.headRow}>
              <th scope="col" className={TABLE.th}>{t('environment.columns.component')}</th>
              <th scope="col" className={TABLE.th}>{t('environment.columns.current')}</th>
              <th scope="col" className={TABLE.th}>{t('environment.columns.replacement')}</th>
            </tr>
          </thead>
          <tbody>
            {components.map((c) => (
              <tr key={c.id} className={TABLE.row}>
                <th scope="row" className={TABLE.rowHeader}>
                  {t(c.nameKey)}
                  <p className="mt-1 font-normal text-text-muted">{t(c.descriptionKey)}</p>
                </th>
                <td className={TABLE.td}>{t(`environment.implementation.${c.implementation}`)}</td>
                <td className={TABLE.td}>{t(c.replacementKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      <section aria-labelledby="chain-title" className="card mt-10 px-5 py-5 sm:px-7">
        <h2 id="chain-title" className="text-[1.375rem] sm:text-2xl">
          {t('environment.chain.title')}
        </h2>
        <p className="mt-2">{t(`environment.chain.${status}`)}</p>
      </section>
      <p className="mt-10 text-text-muted">{t('environment.noDocuments')}</p>
    </Frame>
  );
}
