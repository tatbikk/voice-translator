import type { LegalBasis } from '@mahkama/core';
import type { Translator } from '@/i18n/translate';

/** Third line of every confirmation window: the article the action rests on. */
export function legalBasisText(t: Translator, basis: LegalBasis): string {
  if (basis.kind === 'PLATFORM_ADMINISTRATION') return t('actions.basis.platformAdministration');
  return t('actions.basis.article', { articles: basis.articles.join(t('actions.basis.articleSeparator')) });
}
