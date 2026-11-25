'use client';

// Messages on the client: the page resolves the keys a component needs on the
// server (dictionary()) and passes them down; nothing here reads the files.

export type Dict = Readonly<Record<string, string>>;
export type Params = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

export function tr(dict: Dict, key: string, params: Params = {}): string {
  const template = dict[key];
  if (template === undefined) return key;
  return template.replace(PLACEHOLDER, (match, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : match));
}

/** «5.570 درهم», with centimes only when there are some (as components/case/format.ts). */
export function money(dict: Dict, cents: number): string {
  const value = BigInt(Math.round(cents));
  const whole = (value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = (value % 100n).toString().padStart(2, '0');
  return tr(dict, 'case.amount', { amount: `${whole}${fraction === '00' ? '' : `,${fraction}`}` });
}

/** «المادة 76 من القانون رقم 58.25»، «المادتان 76 و628»… */
export function articlesText(dict: Dict, articles: readonly number[]): string {
  const list = articles.join(tr(dict, 'actions.basis.articleSeparator'));
  const key = articles.length === 1 ? 'actions.basis.article' : articles.length === 2 ? 'actions.basis.articles.two' : 'actions.basis.articles.many';
  return tr(dict, key, { articles: list });
}

/** The text of a refusal of the API. */
export function errorText(dict: Dict, messageKey: string): string {
  return dict[messageKey] ?? dict['errors.INTERNAL'] ?? messageKey;
}
