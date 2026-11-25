import { z } from 'zod';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, notFound } from '@/server/http/responses';
import { draftResource } from '@/server/filings/drafts';
import { withDraft } from '@/server/filings/http';
import { draftDocumentFile } from '@/server/filings/service';

// A document of the draft, to its author: served by the application after the
// check, never from the bucket; as an attachment, never rendered as a page,
// and only while its bytes keep their hash.
export const GET = defineEndpoint({
  id: 'filings.documents.file',
  method: 'GET',
  path: '/api/v1/filings/:draftId/documents/:documentId/file',
  access: { kind: 'action', action: 'filing.draft.read' },
  params: z.strictObject({ draftId: z.uuid(), documentId: z.uuid() }),
  resource: (p) => draftResource(p.draftId),
  handler: ({ params: p, session }) =>
    withDraft(p.draftId, session, async (draft, caller) => {
      const file = await draftDocumentFile(draft, p.documentId, caller.session.actor);
      if (file === 'NOT_FOUND') return notFound();
      if (file === 'INTEGRITY') return fail(503, 'UNAVAILABLE');
      const extension = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[file.mediaType] ?? 'docx';
      return new Response(Buffer.from(file.bytes), {
        status: 200,
        headers: {
          'Content-Type': ['application/pdf', 'image/jpeg', 'image/png'].includes(file.mediaType) ? file.mediaType : 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${p.documentId}.${extension}"`,
          'Content-Length': String(file.bytes.byteLength),
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "sandbox; default-src 'none'",
          'Cache-Control': 'no-store',
        },
      });
    }),
});
