// Legal bases are data, never prose in code: the web app renders them through
// i18n templates (third line of every confirmation window, rule 1 of the prompt).

export type LegalBasis =
  | { readonly kind: 'LAW'; readonly law: '58.25'; readonly articles: readonly number[] }
  | { readonly kind: 'PLATFORM_ADMINISTRATION' };

export const PLATFORM_ADMINISTRATION: LegalBasis = { kind: 'PLATFORM_ADMINISTRATION' };

export function lawArticles(...articles: number[]): LegalBasis {
  if (articles.length === 0) throw new Error('a legal basis needs at least one article');
  for (const article of articles) {
    if (!Number.isInteger(article) || article < 1 || article > 644) {
      throw new Error(`article out of range for Law 58.25: ${String(article)}`);
    }
  }
  return { kind: 'LAW', law: '58.25', articles: [...articles] };
}

export function isLegalBasis(value: unknown): value is LegalBasis {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown; law?: unknown; articles?: unknown };
  if (v.kind === 'PLATFORM_ADMINISTRATION') return true;
  return (
    v.kind === 'LAW' &&
    v.law === '58.25' &&
    Array.isArray(v.articles) &&
    v.articles.length > 0 &&
    v.articles.every((a) => Number.isInteger(a) && (a as number) >= 1 && (a as number) <= 644)
  );
}
