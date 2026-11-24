import { translator } from '@/i18n/translate';
import { Frame } from '@/components/shell/Frames';
import { requireGate } from '@/server/permissions/guard';

// Unknown address, or a page the user may not know about (the page guards answer
// "not found"). Before the visitor passphrase it leads to the passphrase like
// every other page, so that the answer reveals nothing about which addresses exist.
export default async function NotFound() {
  const context = await requireGate('not-found');
  const t = translator(context.locale);
  return (
    <Frame context={context} width="narrow">
      <h1 className="text-[1.75rem] sm:text-[2.125rem]">{t('errors.page.notFound.title')}</h1>
      <p className="mt-4 text-text-muted">{t('errors.page.notFound.text')}</p>
      <p className="mt-8">
        <a href="/">{t('errors.page.home')}</a>
      </p>
    </Frame>
  );
}
