import type { Translator } from './translate';

/**
 * The articles an order or a judgment rests on, after «بناء على»: «المادة 76»،
 * «المادتين 76 و77»، «المواد 76 و77 و628» of Law 58.25 (review P1-L-38). The
 * forms are those of the genitive that follows the preposition; the articles
 * keep the order given.
 */
export function lawArticlesText(t: Translator, articles: readonly number[]): string {
  if (articles.length === 0) throw new Error('a legal basis names at least one article');
  const list = articles.map(String).join(t('common.lawBasis.separator'));
  const key = articles.length === 1 ? 'common.lawBasis.one' : articles.length === 2 ? 'common.lawBasis.two' : 'common.lawBasis.many';
  return t(key, { articles: list });
}
