// Runs once when the server starts (next start), not during the build: the
// boot check refuses to start in production mode with a simulated component,
// a demo tool, demo data, an advanced clock, weak secrets or a database role
// able to rewrite the event log.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { enforceBoot } = await import('./server/boot/check');
  await enforceBoot('web');
}
