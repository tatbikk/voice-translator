import { cx } from './cx';

/**
 * «قيمة مؤقتة غير مؤكدة» beside an amount that rests on a rule the references
 * do not settle (prompt, rule 5): the words themselves, in the warning tone,
 * on the line of the amount or under it.
 */
export function ProvisionalMark({ text, block = false }: { text: string; block?: boolean }) {
  return <span className={cx('text-sm font-normal text-approaching', block ? 'block' : 'ms-2 inline-block')}>{text}</span>;
}
