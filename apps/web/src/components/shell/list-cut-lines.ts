import type { Translator } from '@/i18n/translate';
import type { ListCutLines } from '@/components/ui/ListCut';
import { cutOf, type Page } from '@/server/lists/paging';

/**
 * The lines under a list that does not fit in one page, in the user's
 * language: how many are shown of how many, and the links to the pages
 * around; null for a list shown whole.
 */
export function listCutLines(
  t: Translator,
  page: Page<unknown>,
  options: { readonly list: string; readonly hrefFor: (page: number) => string; readonly summaryKey?: string },
): ListCutLines | null {
  const cut = cutOf(page);
  if (!cut) return null;
  return {
    label: t('lists.cut.label', { list: options.list }),
    summary: t(options.summaryKey ?? 'lists.cut.summary', { from: cut.from, to: cut.to, total: cut.total }),
    rest: cut.next ? t('lists.cut.rest') : null,
    previous: cut.previous ? { href: options.hrefFor(cut.previous), text: t('lists.cut.previous') } : null,
    next: cut.next ? { href: options.hrefFor(cut.next), text: t('lists.cut.next') } : null,
  };
}
