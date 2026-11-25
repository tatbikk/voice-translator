// Review P1-S-15: the HTTP refusal matrix (refusal-matrix.test.ts) requests one
// procedural action only. Here every procedural action of the declarative
// table is requested directly, through the route a browser would use, by every
// member of a file's cast and by people unrelated to it, in two states of the
// file. Whatever the action list of the requester does not hold is refused
// (acceptance criterion 3 of Phase 1: «ورفض الخادم كل إجراء خارجها ولو طلب
// مباشرة»): 403 for whom the file is known to, 404 for the others, exactly as
// for an unknown file; and every refusal is recorded. The actions the list does
// hold are not sent: their execution comes with their screens.
import { beforeAll, describe, expect, it } from 'vitest';
import { PROCEDURE_ACTIONS, SECURITY_POLICY } from '@mahkama/core';
import { login } from '../helpers/auth';
import { caseScenario, type CaseScenario } from '../helpers/cases';
import { eventsAfter, headSeq } from '../helpers/db';
import type { Client } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';

useFreshDatabase();

type CastMember = keyof CaseScenario['users'];

/** Who the file is known to (interface book), written out independently of the core. */
const RELATED: ReadonlySet<CastMember> = new Set(['plaintiffLawyer', 'defenseLawyer', 'rapporteur', 'panelPresident', 'panelMember', 'hearingClerk', 'registrationClerk']);
const CAST: readonly CastMember[] = [
  'plaintiffLawyer',
  'defenseLawyer',
  'otherLawyer',
  'rapporteur',
  'otherRapporteur',
  'panelPresident',
  'panelMember',
  'hearingClerk',
  'registrationClerk',
  'otherCourtClerk',
  'prosecutor',
  'bailiff',
  'expert',
  'admin',
  'validator',
];

// Each refusal is recorded individually up to a budget per session and minute:
// a new session is opened before it is reached.
const PER_SESSION = Math.min(50, SECURITY_POLICY.refusals.authenticatedPerSession.max - 5);

for (const status of ['IN_PREPARATION', 'IN_DELIBERATION'] as const) {
  describe(`every procedural action requested directly, on a file ${status}`, () => {
    let scenario: CaseScenario;
    beforeAll(async () => {
      scenario = await caseScenario({ status });
    }, 60_000);

    it('covers every action of the declarative table', () => {
      expect(PROCEDURE_ACTIONS.length).toBeGreaterThan(80);
    });

    for (const member of CAST) {
      const related = RELATED.has(member);
      it(`${member}: refused ${related ? '403' : '404'} for every action outside its list, each refusal recorded`, async () => {
        const user = scenario.users[member];
        const path = `/api/v1/cases/${scenario.caseFileId}`;
        let client: Client = await login(user);
        const list = await client.get(`${path}/available-actions`);
        expect(list.status, 'the file is known to whom it is related, and only to them').toBe(related ? 200 : 404);
        const allowed = new Set(related ? (list.data as { actions: { code: string }[] }).actions.map((a) => a.code) : []);
        const refused = PROCEDURE_ACTIONS.filter((a) => !allowed.has(a.code));
        expect(refused.length).toBeGreaterThan(PROCEDURE_ACTIONS.length / 2);

        const since = await headSeq();
        const wrong: string[] = [];
        let sent = 0;
        for (const action of refused) {
          if (sent === PER_SESSION) {
            client = await login(user);
            sent = 0;
          }
          const res = await client.post(`${path}/actions/${action.code}`, {});
          sent += 1;
          // An action on another kind of resource (an envelope, a new filing) is unknown on a file.
          const expected = related && action.resource === 'case' ? { status: 403, code: 'FORBIDDEN' } : { status: 404, code: 'NOT_FOUND' };
          if (res.status !== expected.status || res.code !== expected.code) wrong.push(`${action.code}: ${String(res.status)} ${String(res.code)}`);
        }
        expect(wrong, 'answers that differ from the expected refusal').toEqual([]);

        const denied = (await eventsAfter(since, 'access.denied')).filter((e) => e.actorUserId === user.id && e.details.target === 'cases.action');
        expect(denied, 'one access.denied event per refusal').toHaveLength(refused.length);
        expect(denied.every((e) => e.details.step === 'AUTHZ')).toBe(true);
      }, 120_000);
    }
  });
}
