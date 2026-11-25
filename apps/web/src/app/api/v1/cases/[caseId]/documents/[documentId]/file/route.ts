import { z } from 'zod';
import { documentResource } from '@/server/cases/resources';
import { clock } from '@/server/clock';
import { documentBytes, documentRow } from '@/server/documents/service';
import { appendStandaloneEvent } from '@/server/events/append';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, notFound } from '@/server/http/responses';

const SERVED_TYPES: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

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
    if (stored.sha256 !== doc.sha256) {
      await appendStandaloneEvent({
        action: 'document.integrity.failed',
        details: { documentId: doc.id, currentSha256: stored.sha256 },
        caseFileId: doc.caseFileId,
        actor: session?.actor ?? null,
      });
      return fail(503, 'UNAVAILABLE');
    }
    await appendStandaloneEvent({
      action: 'document.downloaded',
      details: { documentId: doc.id },
      caseFileId: doc.caseFileId,
      actor: session?.actor ?? null,
    });
    return new Response(Buffer.from(stored.bytes), {
      status: 200,
      headers: {
        // The stored type when it is one the platform accepts, its extension with it (review P2-S-13).
        'Content-Type': SERVED_TYPES[doc.mediaType] ? doc.mediaType : 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${doc.id}.${SERVED_TYPES[doc.mediaType] ?? 'bin'}"`,
        'Content-Length': String(stored.bytes.byteLength),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Cache-Control': 'no-store',
      },
    });
  },
});
