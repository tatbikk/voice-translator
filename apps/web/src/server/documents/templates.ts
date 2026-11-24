import 'server-only';

// A minimal template language for the document templates (templates/*.html):
// {{key}} inserts an escaped value; {{#key}}…{{/key}} repeats its content for
// each item of a list (or once for a true value), with the item's fields in
// scope; {{@key}} inserts trusted markup produced here (the rendered body, the
// fonts). Nothing a party wrote can become markup: every {{key}} is escaped.

export type TemplateValue = string | number | boolean | null | undefined | readonly TemplateScope[];
export interface TemplateScope {
  readonly [key: string]: TemplateValue;
}

// Braces are escaped too, so that a value can never form a placeholder that a
// later pass would fill.
const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '{': '&#123;', '}': '&#125;' };
export const escapeHtml = (text: string) => text.replace(/[&<>"'{}]/g, (c) => ESCAPES[c] ?? c);

const SECTION = /\{\{#([A-Za-z][A-Za-z0-9_]*)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
const VALUE = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
const TRUSTED = /\{\{@([A-Za-z][A-Za-z0-9_]*)\}\}/g;

export function renderTemplate(template: string, scope: TemplateScope, trusted: Readonly<Record<string, string>> = {}): string {
  const sections = template.replace(SECTION, (_m, key: string, inner: string) => {
    const value = scope[key];
    if (Array.isArray(value)) return value.map((item: TemplateScope) => renderTemplate(inner, { ...scope, ...item })).join('');
    return value ? renderTemplate(inner, scope) : '';
  });
  const values = sections.replace(VALUE, (_m, key: string) => {
    const value = scope[key];
    return value === null || value === undefined || typeof value === 'object' ? '' : escapeHtml(String(value));
  });
  return values.replace(TRUSTED, (_m, key: string) => trusted[key] ?? '');
}
