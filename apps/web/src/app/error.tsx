'use client';

import { ErrorView } from '@/components/shell/ErrorView';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return <ErrorView onRetry={reset} />;
}
