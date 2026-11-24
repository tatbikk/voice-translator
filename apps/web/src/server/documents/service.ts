import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { clock } from '../clock';
import { getDb } from '../db';
import { appendEvent, eventTransaction, type EventActor } from '../events/append';
import { documentStore } from './store';

// Storing and reading the documents of a file. The bytes go to the store under
// a generated key; the table keeps the hash, which never changes afterwards
// (a database trigger refuses it), and a document is never deleted.

export interface StoreDocumentInput {
  readonly caseFileId: string;
  readonly bytes: Uint8Array;
  readonly mediaType: 'application/pdf';
  readonly docType: string;
  readonly title?: string | null;
  readonly visibility: 'CASE' | 'PANEL' | 'JUDGE';
  readonly channel: 'ELECTRONIC' | 'PAPER';
  readonly declaredNature: 'ORIGINAL' | 'CERTIFIED_COPY' | 'PHOTOCOPY' | null;
  readonly generated: boolean;
  readonly simulated?: boolean;
  readonly depositedByUserId: string | null;
  readonly depositedByPartyId: string | null;
  readonly actor?: EventActor | null;
}

export const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export async function storeDocument(input: StoreDocumentInput): Promise<{ id: string; sha256: string }> {
  const id = randomUUID();
  const sha256 = sha256Hex(input.bytes);
  const storageKey = `cases/${input.caseFileId}/${id}`;
  // The bytes first: a row never points at a missing object. An object without
  // its row is unreachable, since the store is never listed.
  await documentStore().put(storageKey, input.bytes, input.mediaType);
  await eventTransaction(async (tx) => {
    await tx.document.create({
      data: {
        id,
        caseFileId: input.caseFileId,
        storageKey,
        sha256,
        byteSize: input.bytes.byteLength,
        mediaType: input.mediaType,
        docType: input.docType,
        title: input.title ?? null,
        declaredNature: input.declaredNature,
        channel: input.channel,
        depositedByUserId: input.depositedByUserId,
        depositedByPartyId: input.depositedByPartyId,
        depositedAt: clock.now(),
        generated: input.generated,
        simulated: input.simulated ?? false,
        visibility: input.visibility,
      },
    });
    await appendEvent(tx, {
      action: 'document.stored',
      details: { documentId: id, sha256, byteSize: input.bytes.byteLength, generated: input.generated, docType: input.docType },
      caseFileId: input.caseFileId,
      actor: input.actor ?? null,
    });
  });
  return { id, sha256 };
}

export interface StoredDocument {
  readonly id: string;
  readonly caseFileId: string;
  readonly sha256: string;
  readonly mediaType: string;
  readonly docType: string;
  readonly visibility: 'CASE' | 'PANEL' | 'JUDGE';
  readonly storageKey: string;
}

export async function documentRow(caseFileId: string, documentId: string): Promise<StoredDocument | null> {
  const row = await getDb().document.findFirst({
    where: { id: documentId, caseFileId },
    select: { id: true, caseFileId: true, sha256: true, mediaType: true, docType: true, visibility: true, storageKey: true },
  });
  return row;
}

/** The current bytes of a document and their hash (which may differ from the stored hash if the object was altered). */
export async function documentBytes(doc: Pick<StoredDocument, 'storageKey'>): Promise<{ bytes: Uint8Array; sha256: string } | null> {
  const bytes = await documentStore().get(doc.storageKey);
  return bytes ? { bytes, sha256: sha256Hex(bytes) } : null;
}
