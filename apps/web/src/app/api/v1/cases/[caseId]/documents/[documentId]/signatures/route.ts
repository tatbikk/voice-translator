import { z } from 'zod';
import { documentResource } from '@/server/cases/resources';
import { clock } from '@/server/clock';
import { documentRow } from '@/server/documents/service';
import { defineEndpoint } from '@/server/http/endpoint';
import { notFound, ok } from '@/server/http/responses';
import { verifyDocumentSignatures } from '@/server/signature/service';

// «التحقق من التوقيع» (prompt, «التوقيع الإلكتروني»): every signature of the
// document checked against the document's current bytes.
export const GET = defineEndpoint({
  id: 'cases.document.signatures',
  method: 'GET',
  path: '/api/v1/cases/:caseId/documents/:documentId/signatures',
  access: { kind: 'action', action: 'case.document.read' },
  params: z.strictObject({ caseId: z.uuid(), documentId: z.uuid() }),
  resource: (params) => documentResource(params.caseId, params.documentId, clock.now()),
  handler: async ({ params, session }) => {
    const doc = await documentRow(params.caseId, params.documentId);
    if (!doc) return notFound();
    const signatures = await verifyDocumentSignatures(doc.id, session?.actor ?? null);
    return ok({
      signatures: signatures.map((s) => ({
        position: s.position,
        signerRole: s.signerRole,
        signedAt: s.signedAt.toISOString(),
        simulated: s.simulated,
        status: s.status,
      })),
    });
  },
});
