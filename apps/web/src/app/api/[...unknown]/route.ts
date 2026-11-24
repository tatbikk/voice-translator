import { defineEndpoint } from '@/server/http/endpoint';
import { notFound } from '@/server/http/responses';

// Any API path that does not exist — including the demo paths in a build made
// without the demo tools — gets the same answer.
const unknown = (method: 'GET' | 'POST') =>
  defineEndpoint({
    id: `api.unknown.${method.toLowerCase()}`,
    method,
    path: '/api/*',
    access: { kind: 'public' },
    handler: async () => {
      await Promise.resolve();
      return notFound();
    },
  });

export const GET = unknown('GET');
export const POST = unknown('POST');
