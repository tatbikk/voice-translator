import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { ContractCheck } from '../messaging/contract';
import type { DocumentStore } from './store';

// Contract of DocumentStore: what any implementation (bucket, disk, a future
// archive service) must do. tests/integration/contracts-phase-1.test.ts runs
// it against the platform's store and an independent one.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`document store contract: ${message}`);
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export const DOCUMENT_STORE_CONTRACT: readonly { name: string; run: (store: DocumentStore, key: string) => Promise<void> }[] = [
  {
    name: 'returns the exact bytes it stored',
    run: async (store, key) => {
      const bytes = new Uint8Array(randomBytes(4096));
      await store.put(key, bytes, 'application/pdf');
      const back = await store.get(key);
      assert(back !== null, 'stored object missing');
      assert(sha(back) === sha(bytes), 'bytes changed');
    },
  },
  {
    name: 'answers null for a key never stored',
    run: async (store, key) => {
      assert((await store.get(`${key}-absent`)) === null, 'unknown key must give null');
    },
  },
  {
    name: 'refuses keys that leave its namespace',
    run: async (store) => {
      for (const bad of ['../etc/passwd', '/absolute/key-123', 'UPPER/CaseKey', 'a', 'key with space']) {
        let refused = false;
        try {
          await store.put(bad, new Uint8Array([1]), 'application/pdf');
        } catch {
          refused = true;
        }
        assert(refused, `key accepted: ${bad}`);
      }
    },
  },
  {
    name: 'keeps a copy independent of the caller buffer',
    run: async (store, key) => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      await store.put(key, bytes, 'application/octet-stream');
      bytes[0] = 9;
      const back = await store.get(key);
      assert(back?.[0] === 1, 'the store must not keep the caller buffer');
    },
  },
];

export type { ContractCheck };
