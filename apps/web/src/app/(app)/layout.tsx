import type { ReactNode } from 'react';
import { DemoSlot } from '@/components/shell/demo-slot';
import { requirePage } from '@/server/permissions/guard';

// Every page of a user with an active session. The session is checked here and
// again by each page, which also checks its own action: a layout is not rendered
// again on client navigation, so it is never the only guard.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const context = await requirePage('layout.app', 'dashboard.view');
  return (
    <>
      {children}
      <DemoSlot context={context} />
    </>
  );
}
