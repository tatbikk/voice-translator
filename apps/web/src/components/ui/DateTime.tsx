import { formatMoroccoDate, formatMoroccoTime } from '@mahkama/core';

/** Moroccan date and time, in the platform's single wording («… على الساعة …»). */
export function DateTime({ value, template }: { value: Date; template: string }) {
  const text = template.replace('{date}', formatMoroccoDate(value)).replace('{time}', formatMoroccoTime(value));
  return <time dateTime={value.toISOString()}>{text}</time>;
}
