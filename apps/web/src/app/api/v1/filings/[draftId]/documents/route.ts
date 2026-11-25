import { SECURITY_POLICY } from '@mahkama/core';
import { defineEndpoint } from '@/server/http/endpoint';
import { draftResource } from '@/server/filings/drafts';
import { answer, withDraft } from '@/server/filings/http';
import { UploadParams, uploadDocument, uploadPolicy } from '@/server/filings/service';

// A document of the draft (the application, an exhibit, a scan): the bytes are
// read only once the request is authorized, within the limit of their place,
// their type read from their content and stored under a generated name (memo
// rows 7 to 13).
export const POST = defineEndpoint({
  id: 'filings.documents.upload',
  method: 'POST',
  path: '/api/v1/filings/:draftId/documents',
  access: { kind: 'action', action: 'filing.draft.edit' },
  params: UploadParams,
  resource: (p) => draftResource(p.draftId),
  rateLimit: (_client, session) => ({ key: `uploads:session:${session?.session.id ?? 'none'}`, rule: SECURITY_POLICY.uploads.perSession }),
  binary: {
    absoluteMaxBytes: SECURITY_POLICY.uploads.scanMaxBytes,
    maxBytes: (p, resource) => uploadPolicy(resource?.kind === 'filing-draft' ? resource.channel : 'ELECTRONIC', p.kind).maxBytes,
  },
  handler: ({ params: p, session, bytes }) =>
    withDraft(p.draftId, session, async (draft, caller) => answer(await uploadDocument(draft, p, bytes ?? new Uint8Array(), caller.session.actor))),
});
