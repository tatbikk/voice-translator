/** The text of a form field: '' when the field is absent or holds a file. */
export function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

/** True when two strings the visitor typed are equal (a confirmation field, not a secret check). */
export function sameText(a: string, b: string): boolean {
  return a.length === b.length && a.localeCompare(b, 'en', { sensitivity: 'variant' }) === 0;
}
