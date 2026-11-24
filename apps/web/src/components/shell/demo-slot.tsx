import { hasAccess } from '@/server/auth/access-gate';
import type { GateContext } from '@/server/permissions/guard';

/**
 * Entry point of the demo bar. Renders nothing outside the demo environment
 * with its tools enabled, nothing to a visitor who has not passed the gate,
 * and nothing at all in a build made without the demo tools (the import below
 * is then dead code, removed at build time).
 */
export async function DemoSlot({ context }: { context: GateContext }) {
  if (process.env.DEMO_ROUTES_BUILT !== 'true') return null;
  if (!context.demoToolsEnabled || !hasAccess(context.req)) return null;
  const { DemoBar } = await import('@/demo/ui/DemoBar');
  return <DemoBar context={context} />;
}
