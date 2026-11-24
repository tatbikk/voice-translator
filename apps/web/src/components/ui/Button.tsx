import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-ink-800 text-white border-ink-800 hover:bg-ink-900 disabled:bg-line-strong disabled:border-line-strong',
  secondary: 'bg-paper text-ink-800 border-line-strong hover:border-ink-800 disabled:text-text-muted',
  quiet: 'bg-transparent text-ink-700 border-transparent underline underline-offset-4 hover:text-ink-900',
};

export function buttonClass(variant: ButtonVariant = 'primary', extra?: string): string {
  return cx(
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border px-5 py-2 text-base font-medium',
    'transition-colors disabled:cursor-not-allowed',
    VARIANTS[variant],
    extra,
  );
}

export function Button({
  variant = 'primary',
  className,
  children,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; children: ReactNode }) {
  return (
    <button type={type} className={buttonClass(variant, className)} {...props}>
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = 'secondary',
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a href={href} className={buttonClass(variant, cx('no-underline', className))}>
      {children}
    </a>
  );
}
