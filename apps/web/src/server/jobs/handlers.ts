import 'server-only';
import { verifyEventChain } from '../events/verify';
import { issueFilingReceipt, issuePaymentReceipt, issueSignatureCertificate, prepareFixedCopy } from '../filings/generated';
import { cleanupExpired } from '../security/maintenance';
import { flushThrottleSummaries } from '../security/refusals';
import type { JobHandlers } from './queue';

// The handlers of every job type, shared by the worker and the tests.
export const JOB_HANDLERS: JobHandlers = {
  'events.verify-chain': async (payload, { stopping }) => {
    await verifyEventChain({ ...(payload.full === undefined ? {} : { full: payload.full }), stopping });
  },
  'maintenance.cleanup': () => cleanupExpired(),
  'security.throttle-summaries': async () => {
    await flushThrottleSummaries();
  },
  'filing.fixed-copy': (payload, context) => prepareFixedCopy(payload.draftId, payload.textDigest, context),
  'payment.receipt': (payload, context) => issuePaymentReceipt(payload.paymentId, context),
  'filing.receipt': (payload, context) => issueFilingReceipt(payload.caseFileId, context),
  'filing.signature-certificate': (payload, context) => issueSignatureCertificate(payload.documentId, context),
};
