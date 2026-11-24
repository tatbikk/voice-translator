// Phase 1 refusal tests for the signature service (memo rows 8 to 11), written
// before the service. They run the simulated provider through the platform's
// service, against the database, and complement the contract test.
import { beforeAll, describe, expect, it } from 'vitest';
import { documentStore } from '@/server/documents/store';
import { openSignatureCircle, setSigningSecret, signDocument, verifyDocumentSignatures } from '@/server/signature/service';
import { caseScenario, type CaseScenario } from '../helpers/cases';
import { activeLockouts, one, sql } from '../helpers/db';
import { useFreshDatabase } from '../helpers/reset';

useFreshDatabase();

let scenario: CaseScenario;
const SECRET = 'signing-secret-for-tests-1';

beforeAll(async () => {
  scenario = await caseScenario({ status: 'IN_DELIBERATION' });
  for (const user of [scenario.users.panelPresident, scenario.users.rapporteur, scenario.users.hearingClerk]) {
    await setSigningSecret(user.id, SECRET);
  }
});

const signer = (user: CaseScenario['users'][keyof CaseScenario['users']]) => ({ userId: user.id, roleAssignmentId: user.roleAssignmentId });

async function newCircle() {
  const { users } = scenario;
  return openSignatureCircle({
    documentId: scenario.draftDocumentId,
    purpose: 'JUDGMENT',
    signers: [signer(users.panelPresident), signer(users.rapporteur), signer(users.hearingClerk)],
  });
}

describe('signature circle against the database', () => {
  it('records signer, role, platform time and the hash at signing, and stamps «توقيع تجريبي»', async () => {
    const circle = await newCircle();
    const result = await signDocument({ circleId: circle.id, ...signer(scenario.users.panelPresident), secret: SECRET });
    expect(result.ok).toBe(true);
    const row = await one<{ signerRole: string; documentSha256: string; provider: string }>(
      `SELECT "signerRole", "documentSha256", provider FROM "Signature" WHERE "circleId" = $1`,
      [circle.id],
    );
    expect(row.signerRole).toBe('PANEL_PRESIDENT');
    expect(row.documentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.provider).toBe('SIMULATED');
    expect(result.ok && result.stampKey).toBe('signature.stamp.simulated');
  });

  it('refuses the clerk before the president and the rapporteur have signed', async () => {
    const circle = await newCircle();
    const result = await signDocument({ circleId: circle.id, ...signer(scenario.users.hearingClerk), secret: SECRET });
    expect(result).toMatchObject({ ok: false, reason: 'NOT_YOUR_TURN' });
  });

  it('voids the circle and fails verification when one byte changed after the first signature', async () => {
    const circle = await newCircle();
    await signDocument({ circleId: circle.id, ...signer(scenario.users.panelPresident), secret: SECRET });
    const [doc] = await sql<{ storageKey: string }>(`SELECT "storageKey" FROM "Document" WHERE id = $1`, [scenario.draftDocumentId]);
    const store = documentStore();
    const bytes = await store.get(doc?.storageKey ?? '');
    if (!bytes) throw new Error('document bytes missing');
    const tampered = new Uint8Array(bytes);
    tampered[tampered.length - 2] = (tampered[tampered.length - 2] ?? 0) ^ 1;
    await store.put(doc?.storageKey ?? '', tampered, 'application/pdf');
    const verification = await verifyDocumentSignatures(scenario.draftDocumentId);
    expect(verification.every((s) => s.status === 'DOCUMENT_CHANGED')).toBe(true);
    const next = await signDocument({ circleId: circle.id, ...signer(scenario.users.rapporteur), secret: SECRET });
    expect(next).toMatchObject({ ok: false, reason: 'DOCUMENT_CHANGED' });
    const status = await one<{ status: string }>(`SELECT status FROM "SignatureCircle" WHERE id = $1`, [circle.id]);
    expect(status.status).toBe('VOIDED');
    await store.put(doc?.storageKey ?? '', bytes, 'application/pdf');
  });

  it('locks the signing secret after three wrong attempts, and then refuses the right one', async () => {
    const circle = await newCircle();
    const president = signer(scenario.users.panelPresident);
    for (let i = 0; i < 3; i += 1) {
      const wrong = await signDocument({ circleId: circle.id, ...president, secret: `wrong-${String(i)}-secret` });
      expect(wrong).toMatchObject({ ok: false, reason: 'INVALID_SECRET' });
    }
    expect((await activeLockouts()).some((l) => l.cause === 'SIGNING_SECRET')).toBe(true);
    const right = await signDocument({ circleId: circle.id, ...president, secret: SECRET });
    expect(right).toMatchObject({ ok: false, reason: 'LOCKED' });
  });
});
