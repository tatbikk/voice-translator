// Review A-17: the endpoint registry restated by hand the access of every
// route, and nothing compared it with the definitions. Every route module named
// by the registry is loaded here, and its handlers' own definition (id, method,
// path, access) must equal the registry entry exactly.
import { describe, expect, it } from 'vitest';
import { ENDPOINTS } from '@/server/http/registry';
import type { EndpointHandler } from '@/server/http/endpoint';

const real = ENDPOINTS.filter((e) => !e.demoBuildOnly && !e.path.endsWith('*'));

describe('the endpoint registry matches the endpoint definitions', () => {
  for (const entry of real) {
    it(`${entry.method} ${entry.path}`, async () => {
      const module = (await import(/* @vite-ignore */ entry.module.replace('@/', '../../src/'))) as Record<string, EndpointHandler | undefined>;
      const handler = module[entry.method];
      expect(handler, `${entry.module} exports ${entry.method}`).toBeDefined();
      if (!handler) return;
      expect(handler.endpointId).toBe(entry.id);
      expect(handler.endpointMethod).toBe(entry.method);
      expect(handler.endpointPath).toBe(entry.path);
      const access = handler.endpointAccess;
      const expected =
        access.kind === 'pending-session'
          ? { kind: access.kind, states: access.states, ...(access.orAction ? { action: access.orAction } : {}) }
          : access;
      expect(entry.access).toEqual(expected);
    });
  }
});
