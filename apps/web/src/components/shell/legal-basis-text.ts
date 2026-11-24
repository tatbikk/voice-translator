import type { LegalBasis } from '@mahkama/core';
import type { Translator } from '@/i18n/translate';

/** Third line of every confirmation window: the article the action rests on. */
export function legalBasisText(t: Translator, basis: LegalBasis): string {
  if (basis.kind === 'PLATFORM_ADMINISTRATION') return t('actions.basis.platformAdministration');
  // «المادة 628»، «المادتان 76 و628»، «المواد 76 و628 و629» (glossary, rule 10).
  const articles = basis.articles.join(t('actions.basis.articleSeparator'));
  const key =
    basis.articles.length === 1 ? 'actions.basis.article' : basis.articles.length === 2 ? 'actions.basis.articles.two' : 'actions.basis.articles.many';
  return t(key, { articles });
}
