import { cx } from './cx';

export type DeadlineState = 'elapsed' | 'approaching' | 'running';

/**
 * Time-limit counter: red for an elapsed limit, orange for one that approaches.
 * The state is always written out as well, never conveyed by colour alone.
 */
export function DeadlineCounter({ state, stateLabel, untilText }: { state: DeadlineState; stateLabel: string; untilText: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 border-s-4 px-2 py-1 text-sm',
        state === 'elapsed' && 'border-elapsed bg-elapsed-bg text-elapsed',
        state === 'approaching' && 'border-approaching bg-approaching-bg text-approaching',
        state === 'running' && 'border-line-strong bg-paper text-text',
      )}
    >
      <strong className="font-semibold">{stateLabel}</strong>
      <span>{untilText}</span>
    </span>
  );
}
