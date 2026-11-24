import { z } from 'zod';
import { documentResource } from '@/server/cases/resources';
import { clock } from '@/server/clock';
import { documentBytes, documentRow } from '@/server/documents/service';
import { appendStandaloneEvent } from '@/server/events/append';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, notFound } from '@/server/http/responses';

// A document of the file, to whoever may see it (prompt, «المدخلات والملفات»):
// served by the application after the check, never from the bucket; as an
// attachment of its stored type, never rendered as a web page.
export const GET = defineEndpoint({
  id: 'cases.document.file',
  method: 'GET',
  path: '/api/v1/cases/:caseId/documents/:documentId/file',
  access: { kind: 'action', action: 'case.document.read' },
  params: z.strictObject({ caseId: z.uuid(), documentId: z.uuid() }),
  resource: (params) => documentResource(params.caseId, params.documentId, clock.now()),
  handler: async ({ params, session }) => {
    const doc = await documentRow(params.caseId, params.documentId);
    if (!doc) return notFound();
    const stored = await documentBytes(doc);
    if (!stored) return fail(503, 'UNAVAILABLE');
    await appendStandaloneEvent({
      action: 'document.downloaded',
      details: { documentId: doc.id },
      caseFileId: doc.caseFileId,
      actor: session?.actor ?? null,
    });
    return new Response(Buffer.from(stored.bytes), {
      status: 200,
      headers: {
        'Content-Type': doc.mediaType === 'application/pdf' ? 'application/pdf' : 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${doc.id}.pdf"`,
        'Content-Length': String(stored.bytes.byteLength),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Cache-Control': 'no-store',
      },
    });
  },
});
