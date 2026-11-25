import 'server-only';
import type { Resource } from '@mahkama/core';
import { getDb } from '../db';
import { caseSnapshot } from './snapshot';

// Resource loaders of the case routes: what authorize() decides on. A file or a
// document that does not exist answers null, which the endpoint turns into the
// same 404 as a refusal.

export async function caseResource(caseFileId: string, now: Date): Promise<Resource | null> {
  const snapshot = await caseSnapshot(caseFileId, now);
  return snapshot ? { kind: 'case', snapshot } : null;
}

export async function documentResource(caseFileId: string, documentId: string, now: Date): Promise<Resource | null> {
  const doc = await getDb().document.findFirst({ where: { id: documentId, caseFileId }, select: { visibility: true } });
  if (!doc) return null;
  const snapshot = await caseSnapshot(caseFileId, now);
  return snapshot ? { kind: 'case-document', snapshot, visibility: doc.visibility, documentId } : null;
}
