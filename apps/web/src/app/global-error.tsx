'use client';

import { ErrorView } from '@/components/shell/ErrorView';

// Shown only when the root layout itself fails. Next.js prerenders it as static
// HTML; it works without any script (links only).
export default function GlobalError() {
  return (
    <html lang="ar-MA" dir="rtl">
      <body>
        <ErrorView />
      </body>
    </html>
  );
}
