import { notFound } from 'next/navigation';
import { translator } from '@/i18n/translate';
import { PageHeader } from '@/components/ui/PageHeader';
import { Frame } from '@/components/shell/Frames';
import { replaceableComponents } from '@/server/components/registry';
import { requireGate } from '@/server/permissions/guard';
import { chainStatus } from '@/server/events/status';
import type { Metadata } from 'next';
import { screenMetadata } from '@/server/page-metadata';

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
      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-line bg-paper">
          <caption className="sr-only">{t('screens.environment')}</caption>
          <thead>
            <tr className="border-b border-line bg-ink-50">
              <th scope="col" className="px-4 py-2 text-start">{t('environment.columns.component')}</th>
              <th scope="col" className="px-4 py-2 text-start">{t('environment.columns.current')}</th>
              <th scope="col" className="px-4 py-2 text-start">{t('environment.columns.replacement')}</th>
            </tr>
          </thead>
          <tbody>
            {components.map((c) => (
              <tr key={c.id} className="border-b border-line align-top">
                <th scope="row" className="px-4 py-3 text-start font-semibold">
                  {t(c.nameKey)}
                  <p className="mt-1 font-normal text-text-muted">{t(c.descriptionKey)}</p>
                </th>
                <td className="px-4 py-3">{t(`environment.implementation.${c.implementation}`)}</td>
                <td className="px-4 py-3">{t(c.replacementKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-labelledby="chain-title" className="mt-10">
        <h2 id="chain-title" className="text-xl">
          {t('environment.chain.title')}
        </h2>
        <p className="mt-2">{t(`environment.chain.${status}`)}</p>
      </section>
      <p className="mt-10 text-text-muted">{t('environment.noDocuments')}</p>
    </Frame>
  );
}
