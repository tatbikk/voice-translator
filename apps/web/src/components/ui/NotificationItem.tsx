import type { ReactNode } from 'react';
import { cx } from './cx';

export type NotificationKind = 'LEGAL_NOTIFICATION' | 'INFORMATION' | 'REMINDER';

// The three kinds are told apart by their label and their border style, not by colour alone.
const KIND_STYLE: Record<NotificationKind, string> = {
  LEGAL_NOTIFICATION: 'border-s-4 border-double border-ink-900',
  INFORMATION: 'border-s-2 border-solid border-line-strong',
  REMINDER: 'border-s-4 border-dashed border-approaching',
};

export function NotificationItem({
  kind,
  kindLabel,
  text,
  when,
  read,
  readLabel,
  action,
  surface = 'paper',
}: {
  kind: NotificationKind;
  kindLabel: string;
  text: string;
  when: ReactNode;
  read: boolean;
  readLabel?: string;
  action?: ReactNode;
  /** the item stands out from what holds it: white on the canvas, tinted inside a white box */
  surface?: 'paper' | 'canvas';
}) {
  return (
    <article
      className={cx('rounded-e-md px-4 py-3', surface === 'canvas' ? 'bg-canvas' : 'bg-paper', KIND_STYLE[kind], !read && 'font-medium')}
    >
      <p className="text-sm text-text-muted">
        <span className="font-semibold text-ink-800">{kindLabel}</span>
        <span aria-hidden="true"> · </span>
        {when}
        {read && readLabel ? (
          <>
            <span aria-hidden="true"> · </span>
            <span>{readLabel}</span>
          </>
        ) : null}
      </p>
      <p className="mt-1">{text}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </article>
  );
}
