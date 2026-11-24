import type { ReactNode } from 'react';
import { DemoSlot } from '@/components/shell/demo-slot';
import { requireGate } from '@/server/permissions/guard';

// Every page past the visitor gate. The gate is checked here and again by each
// page: a layout is not rendered again on client navigation, so it is never the
// only guard. The demo bar is rendered here, and never under (pre-gate).
export default async function GateLayout({ children }: { children: ReactNode }) {
  const context = await requireGate('layout.gate');
  return (
    <>
      {children}
      <DemoSlot context={context} />
    </>
  );
}
