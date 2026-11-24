import type { ReactNode } from 'react';

export function PageHeader({ title, intro, children }: { title: string; intro?: string; children?: ReactNode }) {
  return (
    <header className="mb-8 border-b border-line pb-5">
      <h1 className="text-2xl sm:text-3xl">{title}</h1>
      {intro ? <p className="mt-3 max-w-3xl text-text-muted">{intro}</p> : null}
      {children}
    </header>
  );
}
