// Full verification of the event chain (npm run events:verify). Exit code 0
// when the chain is intact, 1 when it is broken.
import { closeDb } from '@/server/db';
import { verifyEventChain } from '@/server/events/verify';

const report = await verifyEventChain({ full: true });
if (report.result.ok) {
  console.log(JSON.stringify({ level: 'info', msg: 'event chain intact', count: report.result.count, headSeq: report.result.head?.seq ?? 0 }));
} else {
  console.error(
    JSON.stringify({ level: 'error', msg: 'event chain broken', brokenAtSeq: report.result.brokenAtSeq, reason: report.result.reason }),
  );
}
await closeDb();
process.exit(report.result.ok ? 0 : 1);
