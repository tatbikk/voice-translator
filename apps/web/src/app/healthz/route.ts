import { defineEndpoint } from '@/server/http/endpoint';
import { checkDatabase } from '@/server/health';

// Health check for the host's deploy probe: database reachable or not, nothing else.
export const GET = defineEndpoint({
  id: 'healthz',
  method: 'GET',
  path: '/healthz',
  access: { kind: 'public' },
  platformClock: false,
  handler: async () => {
    const up = await checkDatabase();
    return new Response(JSON.stringify({ status: up ? 'ok' : 'unavailable' }), {
      status: up ? 200 : 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  },
});
