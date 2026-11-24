/** One look for every table: inside a card, a tinted head row, hairlines between rows. */
export const TABLE = {
  wrap: 'card overflow-x-auto',
  table: 'w-full border-collapse text-start',
  headRow: 'bg-ink-100',
  th: 'border-b border-line px-4 py-3 text-start text-sm font-semibold text-ink-900',
  rowHeader: 'px-4 py-3.5 text-start font-semibold text-ink-900',
  row: 'border-b border-line align-top last:border-b-0',
  td: 'px-4 py-3.5',
} as const;
