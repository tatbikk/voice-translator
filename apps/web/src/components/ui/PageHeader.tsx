import type { ReactNode } from 'react';

/** Title of a page: an optional kicker line above it, the title, its introduction, then what the page adds. */
export function PageHeader({
  title,
  intro,
  kicker,
  children,
}: {
  title: string;
  intro?: string;
  kicker?: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8 border-b border-line pb-6">
      {kicker ? <p className="kicker mb-1.5">{kicker}</p> : null}
      <h1 className="text-[1.75rem] sm:text-[2.125rem]">{title}</h1>
      {intro ? <p className="mt-3 max-w-3xl text-text-muted">{intro}</p> : null}
      {children}
    </header>
  );
}
