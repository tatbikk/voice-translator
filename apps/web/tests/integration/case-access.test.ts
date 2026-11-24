// Phase 1 refusal tests (docs/security/phase-1-memo.md, rows 1 to 7, 13 to 15),
// written before the code they guard. A case file and its cast are created;
// every request below goes through the route handlers exactly as a browser's
// would, and every expected refusal must leave an access.denied event.
import { beforeAll, describe, expect, it } from 'vitest';
import { login } from '../helpers/auth';
import { capturingEvents, runtime, sql } from '../helpers/db';
import { caseScenario, type CaseScenario } from '../helpers/cases';
import type { Client } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';

useFreshDatabase();

let scenario: CaseScenario;
const clients = new Map<string, Client>();
async function as(name: keyof CaseScenario['users']): Promise<Client> {
  let client = clients.get(name);
  if (!client) {
    client = await login(scenario.users[name]);
    clients.set(name, client);
  }
  return client;
}

const casePath = () => `/api/v1/cases/${scenario.caseFileId}`;

async function expectDenied(fn: () => Promise<{ status: number }>, status: number) {
  const { result, events } = await capturingEvents(fn);
  expect(result.status).toBe(status);
  expect(events.some((e) => e.action === 'access.denied')).toBe(true);
}

beforeAll(async () => {
  scenario = await caseScenario({ status: 'IN_PREPARATION' });
});

describe('the case file and its available actions', () => {
  it('answers counsel in the case with the actions of the study for that state', async () => {
    const res = await (await as('plaintiffLawyer')).get(`${casePath()}/available-actions`);
    expect(res.status).toBe(200);
    const codes = (res.data as { actions: { code: string }[] }).actions.map((a) => a.code).sort();
    expect(codes).toEqual(['case.address.change-notice', 'case.brief.file', 'case.exhibit.file', 'case.extension.request'].sort());
  });

  it('gives every listed action its three confirmation lines and its legal basis', async () => {
    const res = await (await as('rapporteur')).get(`${casePath()}/available-actions`);
    const actions = (res.data as { actions: { label: string; effect: string; notified: string; legalBasis: string }[] }).actions;
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.label).toBeTruthy();
      expect(action.effect).toBeTruthy();
      expect(action.notified).toBeTruthy();
      expect(action.legalBasis).toMatch(/المادة|المادتان|المواد/);
    }
  });

  for (const name of ['otherLawyer', 'otherRapporteur', 'otherCourtClerk', 'bailiff', 'expert', 'admin', 'validator'] as const) {
    it(`answers ${name}, who has no relation to the case, exactly as for an unknown case`, async () => {
      const client = await as(name);
      await expectDenied(() => client.get(`${casePath()}/available-actions`), 404);
      await expectDenied(() => client.get(`/api/v1/cases/00000000-0000-4000-8000-000000000999/available-actions`), 404);
      await expectDenied(() => client.get(`${casePath()}/documents/${scenario.applicationDocumentId}/file`), 404);
      await expectDenied(() => client.post(`${casePath()}/actions/case.brief.file`, {}), 404);
    });
  }

  it('refuses a direct request for an action the state does not allow, and records the refusal', async () => {
    const lawyer = await as('plaintiffLawyer');
    await expectDenied(() => lawyer.post(`${casePath()}/actions/case.declare-ready`, {}), 403);
    await expectDenied(() => lawyer.post(`${casePath()}/actions/case.judgment.pronounce`, {}), 403);
    await expectDenied(() => lawyer.post(`${casePath()}/actions/case.appeal.file`, {}), 403);
    const rapporteur = await as('rapporteur');
    await expectDenied(() => rapporteur.post(`${casePath()}/actions/case.hearing.reserve`, {}), 403);
    await expectDenied(() => rapporteur.post(`${casePath()}/actions/case.rapporteur.change`, {}), 403);
  });

  it('refuses an unknown action code as a resource that does not exist', async () => {
    const lawyer = await as('plaintiffLawyer');
    await expectDenied(() => lawyer.post(`${casePath()}/actions/case.reject-application`, {}), 404);
  });

  it('does not execute from the generic route an action whose screen is not built (decision 45)', async () => {
    const lawyer = await as('plaintiffLawyer');
    const res = await lawyer.post(`${casePath()}/actions/case.brief.file`, {});
    expect(res.status).toBe(409);
    expect(res.code).toBe('ACTION_NOT_EXECUTABLE_HERE');
  });
});

describe('documents', () => {
  it('serves a document of the case to counsel as an attachment that a browser cannot render', async () => {
    const res = await (await as('plaintiffLawyer')).get(`${casePath()}/documents/${scenario.applicationDocumentId}/file`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toMatch(/sandbox/);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('refuses a document of another case reached through this case', async () => {
    const other = await caseScenario({ status: 'IN_PREPARATION' });
    const lawyer = await as('plaintiffLawyer');
    await expectDenied(() => lawyer.get(`${casePath()}/documents/${other.applicationDocumentId}/file`), 404);
  });

  for (const name of ['hearingClerk', 'registrationClerk', 'plaintiffLawyer', 'defenseLawyer', 'prosecutor'] as const) {
    it(`hides the judgment draft from ${name} before pronouncement`, async () => {
      const client = await as(name);
      await expectDenied(() => client.get(`${casePath()}/documents/${scenario.draftDocumentId}/file`), 404);
    });
  }

  it('serves the judgment draft to a member of the panel', async () => {
    const res = await (await as('panelMember')).get(`${casePath()}/documents/${scenario.draftDocumentId}/file`);
    expect(res.status).toBe(200);
  });
});

describe('rule tables and the event log', () => {
  it('lets the runtime role read the rule tables but never change them', async () => {
    await expect(runtime().query(`SELECT count(*) FROM "RuleSet"`)).resolves.toBeDefined();
    await expect(runtime().query(`UPDATE "RuleSet" SET version = version`)).rejects.toThrow(/permission denied/);
    await expect(runtime().query(`DELETE FROM "RuleSet"`)).rejects.toThrow(/permission denied/);
    await expect(runtime().query(`INSERT INTO "RuleSet" (id) VALUES (gen_random_uuid())`)).rejects.toThrow(/permission denied/);
  });

  it('refuses to edit or erase an event of the case, so that the timeline cannot be rewritten', async () => {
    await (await as('otherLawyer')).get(`${casePath()}/available-actions`);
    const [row] = await sql<{ seq: string }>(`SELECT seq FROM "Event" ORDER BY seq DESC LIMIT 1`);
    expect(row).toBeDefined();
    await expect(runtime().query(`UPDATE "Event" SET action = 'x' WHERE seq = $1`, [row?.seq])).rejects.toThrow();
    await expect(runtime().query(`DELETE FROM "Event" WHERE seq = $1`, [row?.seq])).rejects.toThrow();
  });
});
