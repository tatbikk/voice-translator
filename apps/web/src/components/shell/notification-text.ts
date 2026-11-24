import type { Translator } from '@/i18n/translate';

/**
 * Text of a stored notification. Parameters whose name ends in "Key" hold an
 * i18n key (for example roleKey: roles.LAWYER) and are translated first, then
 * passed without the suffix (role).
 */
export function notificationText(t: Translator, templateKey: string, params: Readonly<Record<string, string | number>>): string {
  const resolved: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(params)) {
    if (name.endsWith('Key') && typeof value === 'string') resolved[name.slice(0, -3)] = t(value);
    else resolved[name] = value;
  }
  return t(templateKey, resolved);
}
