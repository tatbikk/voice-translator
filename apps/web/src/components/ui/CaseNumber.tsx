import { formatCaseNumber, type CaseNumber as CaseNumberValue } from '@mahkama/core';

/**
 * The case number as practitioners write it (number/code/year), isolated as a
 * left-to-right run inside Arabic text, with a spoken label that names each
 * part for screen readers.
 */
export function CaseNumber({ value, labelTemplate }: { value: CaseNumberValue; labelTemplate: string }) {
  const label = labelTemplate
    .replace('{number}', String(value.number))
    .replace('{code}', String(value.code))
    .replace('{year}', String(value.year));
  return (
    <bdi className="ltr-run tabular-nums" dir="ltr" aria-label={label}>
      {formatCaseNumber(value)}
    </bdi>
  );
}
