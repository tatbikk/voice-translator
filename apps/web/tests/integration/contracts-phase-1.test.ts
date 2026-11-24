// Contract tests of the two components Phase 1 adds behind an internal
// interface (CLAUDE.md): the signature provider and the document store. Each
// contract runs against the implementation in use and against a second,
// independent one written here, so that the checks test the interface.
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_STORE_CONTRACT } from '@/server/documents/contract';
import { documentStore } from '@/server/documents/store';
import type { DocumentStore } from '@/server/documents/store';
import { SIGNATURE_CONTRACT } from '@/server/signature/contract';
import { signatureProvider } from '@/server/signature/provider';
import type { SignatureProvider } from '@/server/signature/provider';
import { useFreshDatabase } from '../helpers/reset';

useFreshDatabase();

function memoryStore(): DocumentStore {
  const blobs = new Map<string, Uint8Array>();
  return {
    kind: 'memory',
    async put(key, bytes) {
      await Promise.resolve();
      if (!/^[a-z0-9/-]{8,200}$/.test(key)) throw new Error('invalid key');
      blobs.set(key, new Uint8Array(bytes));
    },
    async get(key) {
      await Promise.resolve();
      const found = blobs.get(key);
      return found ? new Uint8Array(found) : null;
    },
  };
}

function hashOnlyProvider(): SignatureProvider {
  return {
    component: {
      id: 'signature',
      nameKey: 'components.signature.name',
      descriptionKey: 'components.signature.description',
      replacementKey: 'components.signature.replacement',
      implementation: 'test',
    },
    async sign(request) {
      await Promise.resolve();
      if (!/^[0-9a-f]{64}$/.test(request.documentSha256)) throw new Error('invalid hash');
      const ref = createHash('sha256').update(`${request.documentSha256}:${request.signerUserId}:${request.at.toISOString()}`).digest('hex');
      return { providerRef: ref, documentSha256: request.documentSha256, signedAt: request.at, simulated: true };
    },
    async verify(record, currentSha256) {
      await Promise.resolve();
      return record.documentSha256 === currentSha256 ? 'VALID' : 'DOCUMENT_CHANGED';
    },
  };
}

describe('document store contract', () => {
  for (const [name, store] of [
    ['platform store', () => documentStore()],
    ['memory store', memoryStore],
  ] as const) {
    for (const check of DOCUMENT_STORE_CONTRACT) {
      it(`${name}: ${check.name}`, async () => {
        await check.run(store(), `test/${randomUUID()}`);
      });
    }
  }
});

describe('signature provider contract', () => {
  for (const [name, provider] of [
    ['platform provider', () => signatureProvider()],
    ['hash-only provider', hashOnlyProvider],
  ] as const) {
    for (const check of SIGNATURE_CONTRACT) {
      it(`${name}: ${check.name}`, async () => {
        await check.run(provider());
      });
    }
  }

  it('declares the platform provider simulated, so production refuses to boot with it', () => {
    expect(signatureProvider().component.implementation).toBe('simulated');
  });
});
