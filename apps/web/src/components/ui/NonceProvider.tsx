'use client';

import { setNonce } from 'get-nonce';
import type { ReactNode } from 'react';

// Radix overlays inject a <style> element when they open; get-nonce gives it the
// request's nonce, so the content security policy can stay strict (no
// 'unsafe-inline').
export function NonceProvider({ nonce, children }: { nonce: string; children: ReactNode }) {
  if (nonce) setNonce(nonce);
  return <>{children}</>;
}
