// Independent review IR-08, written before the code: what Phase 3 needs about the
// parties is kept when the case is registered (arts. 77, 88 and 89).
//   - each party keeps its «صفة» (quality), and each of its addresses its kind,
//     its locality, or its country when it lies outside the Kingdom;
//   - each address knows whether it lies within the district of the court the
//     case is registered in, from the districts table in force: yes or no when
//     the locality is known, unknown when it is not; an address abroad is not;
//   - a residence stays a residence (G012), never a domicile;
//   - a locality the districts table does not know is refused with the card;
//   - the case page shows the quality with the party, to whoever sees the
//     party, and the contacts stay as visible as they were.
import { beforeAll, describe, expect, it } from 'vitest';
import type { UserSubject } from '@mahkama/core';
import { caseSnapshot } from '@/server/cases/snapshot';
import { caseView } from '@/server/cases/view';
import { ruleSourceFiles } from '@/server/rules/store';
import { MODEL_CASE, withParties, type CardParty } from '../acceptance/model-case-filing.fixture';
import { login } from '../helpers/auth';
import { capturingEvents, events, one, sql } from '../helpers/db';
import { createUser, theCourt, type TestUser } from '../helpers/factories';
import { createDraft, fileCase, getDraft, giveSigningSecret, updateDraft, type FiledCase } from '../helpers/filings';
import { describeResponse, type Client } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';
import { loadRuleTables, makeModelCourt } from '../helpers/rules';

useFreshDatabase();

/** A defendant whose residence is in Rabat: a locality of the table, outside the district of the model court. */
const RESIDENT_IN_RABAT: CardParty = {
  key: 'zay',
  side: 'DEFENDANT',
  personKind: 'NATURAL',
  name: 'السيد زاي',
  quality: 'مدعى عليه',
  idNumber: 'DEMO-CIN-0011',
  residence: { value: 'الرباط، حي المثال، رقم 8', locality: 'rabat', source: 'DECLARED' },
};

/** A guarantor whose domicile is outside the Kingdom (art. 89). */
const DOMICILED_ABROAD: CardParty = {
  key: 'taa',
  side: 'GUARANTOR',
  personKind: 'NATURAL',
  name: 'السيدة طاء',
  quality: 'كفيلة متضامنة',
  domicile: { value: 'مدريد، شارع المثال، رقم 3', country: 'إسبانيا', source: 'DECLARED' },
};

/** A guarantor whose domicile names no locality: whether it lies within the district is unknown. */
const LOCALITY_UNKNOWN: CardParty = {
  key: 'sin',
  side: 'GUARANTOR',
  personKind: 'NATURAL',
  name: 'السيد سين',
  domicile: { value: 'حي المثال، رقم 12', source: 'DECLARED' },
};

interface AddressRow {
  readonly name: string;
  readonly quality: string | null;
  readonly kind: string;
  readonly locality: string | null;
  readonly country: string | null;
  readonly within: boolean | null;
}

async function addressesOf(caseFileId: string): Promise<AddressRow[]> {
  return sql<AddressRow>(
    `SELECT p."displayName" AS name, p.quality, a.kind::text AS kind, a.locality, a.country, a."withinCourtDistrict" AS within
       FROM "PartyAddress" a JOIN "CaseParty" p ON p.id = a."partyId"
      WHERE p."caseFileId" = $1
      ORDER BY p.position, a.kind::text`,
    [caseFileId],
  );
}

async function subjectOf(user: TestUser): Promise<UserSubject> {
  const row = await one<{ role: UserSubject['role']; courtId: string | null; panelId: string | null; organizationId: string | null }>(
    `SELECT role, "courtId", "panelId", "organizationId" FROM "RoleAssignment" WHERE id = $1`,
    [user.roleAssignmentId],
  );
  return {
    kind: 'user',
    userId: user.id,
    role: row.role,
    roleAssignmentId: user.roleAssignmentId,
    courtId: row.courtId,
    panelId: row.panelId,
    organizationId: row.organizationId,
    isDemoAccount: false,
    roleCount: 1,
    verificationStatus: 'VERIFIED_SIMULATED',
  };
}

async function viewAs(user: TestUser, caseFileId: string) {
  const snapshot = await caseSnapshot(caseFileId, new Date());
  if (!snapshot) throw new Error('no snapshot');
  return caseView(caseFileId, await subjectOf(user), snapshot);
}

const DISTRICTS_VERSION = ruleSourceFiles().find((r) => r.kind === 'DISTRICTS' && r.validTo === null)?.version;

let lawyer: Client;
let lawyerUser: TestUser;
let registry: TestUser;
let litigant: TestUser;
let model: FiledCase & { draftId: string };
let mixed: FiledCase & { draftId: string };

beforeAll(async () => {
  const court = await theCourt();
  loadRuleTables();
  await makeModelCourt(court.id);
  lawyerUser = await createUser({ roles: ['LAWYER'], label: 'addresses-lawyer' });
  registry = await createUser({ roles: ['CLERK_REGISTRATION'], label: 'addresses-registry' });
  litigant = await createUser({ roles: ['LITIGANT'], label: 'addresses-litigant' });
  const secret = await giveSigningSecret(lawyerUser.id);
  lawyer = await login(lawyerUser);
  model = await fileCase(lawyer, secret, { exhibits: 1 });
  mixed = await fileCase(lawyer, secret, { exhibits: 1, card: withParties(MODEL_CASE, [RESIDENT_IN_RABAT, DOMICILED_ABROAD, LOCALITY_UNKNOWN]) });
}, 180_000);

describe('the parties of the model case, as registered (independent review IR-08)', () => {
  it('keeps for each party its quality, and for each address its kind, its locality and whether it lies within the district of the court', async () => {
    expect(await addressesOf(model.caseFileId)).toEqual([
      { name: 'شركة ألف للتوريدات', quality: 'مدعية', kind: 'ELECTRONIC', locality: null, country: null, within: null },
      { name: 'شركة ألف للتوريدات', quality: 'مدعية', kind: 'REGISTERED_OFFICE', locality: 'casablanca', country: null, within: true },
      { name: 'شركة باء للصناعة', quality: 'مدعى عليها', kind: 'REGISTERED_OFFICE', locality: 'casablanca', country: null, within: true },
      { name: 'السيد جيم', quality: 'كفيل متضامن', kind: 'DOMICILE', locality: 'casablanca', country: null, within: true },
    ]);
  });

  it('records with the registration the version of the districts table it read', async () => {
    expect(DISTRICTS_VERSION).toBeDefined();
    const registered = (await events('case.registered')).find((e) => e.details.caseFileId === model.caseFileId);
    expect(registered?.details.districtsVersion).toBe(DISTRICTS_VERSION);
  });
});

describe('a residence, a locality outside the district, an address abroad, a locality unknown', () => {
  it('keeps a residence as a residence, never as a domicile (G012), and a locality outside the district as outside it', async () => {
    const rows = (await addressesOf(mixed.caseFileId)).filter((r) => r.name === RESIDENT_IN_RABAT.name);
    expect(rows).toEqual([{ name: 'السيد زاي', quality: 'مدعى عليه', kind: 'RESIDENCE', locality: 'rabat', country: null, within: false }]);
  });

  it('keeps the country of an address outside the Kingdom, which lies within no district of the Kingdom (art. 89)', async () => {
    const rows = (await addressesOf(mixed.caseFileId)).filter((r) => r.name === DOMICILED_ABROAD.name);
    expect(rows).toEqual([{ name: 'السيدة طاء', quality: 'كفيلة متضامنة', kind: 'DOMICILE', locality: null, country: 'إسبانيا', within: false }]);
  });

  it('leaves unknown whether an address without locality lies within the district, and the quality not given empty', async () => {
    const rows = (await addressesOf(mixed.caseFileId)).filter((r) => r.name === LOCALITY_UNKNOWN.name);
    expect(rows).toEqual([{ name: 'السيد سين', quality: null, kind: 'DOMICILE', locality: null, country: null, within: null }]);
  });

  it('keeps the residence a residence in the saved card the lawyer reads again', async () => {
    const draftId = await createDraft(lawyer);
    const saved = await updateDraft(lawyer, draftId, { card: withParties(MODEL_CASE, [RESIDENT_IN_RABAT]) });
    expect(saved.status, describeResponse(saved)).toBe(200);
    const party = (await getDraft(lawyer, draftId)).draft.card.parties.find((p) => p.key === RESIDENT_IN_RABAT.key);
    expect(party?.domicile).toBeUndefined();
    expect(party?.residence).toEqual(RESIDENT_IN_RABAT.residence);
  });

  it('refuses, and records the refusal of, a card whose address names a locality the districts table does not know', async () => {
    const draftId = await createDraft(lawyer);
    const unknown: CardParty = { ...RESIDENT_IN_RABAT, residence: { value: 'طنجة، حي المثال، رقم 8', locality: 'tangier', source: 'DECLARED' } };
    const { result, events: appended } = await capturingEvents(() => updateDraft(lawyer, draftId, { card: withParties(MODEL_CASE, [unknown]) }));
    expect(result.status, describeResponse(result)).toBe(422);
    expect(result.code).toBe('INVALID_INPUT');
    expect(result.error?.fields).toEqual({ 'card.parties.3.residence.locality': 'errors.field.invalid' });
    expect(appended.some((e) => e.action === 'filing.refused')).toBe(true);
    expect((await getDraft(lawyer, draftId)).draft.card.parties).toEqual([]);
  });

  it('refuses a card whose address names both a locality and a country', async () => {
    const draftId = await createDraft(lawyer);
    const both: CardParty = { ...DOMICILED_ABROAD, domicile: { value: 'مدريد، شارع المثال، رقم 3', locality: 'casablanca', country: 'إسبانيا', source: 'DECLARED' } };
    const res = await updateDraft(lawyer, draftId, { card: withParties(MODEL_CASE, [both]) });
    expect(res.status, describeResponse(res)).toBe(422);
    expect(res.error?.fields?.['card.parties.3.domicile.country']).toBe('errors.field.invalid');
  });
});

describe('the quality on the case page', () => {
  it('shows the quality with each party to the court and to counsel', async () => {
    for (const user of [registry, lawyerUser]) {
      const view = await viewAs(user, model.caseFileId);
      expect(view?.parties.map((p) => [p.displayName, p.quality]), user.id).toEqual(MODEL_CASE.parties.map((p) => [p.name, p.quality ?? null]));
    }
  });

  it('shows it to a litigant of the file, whose view of the other parties’ contacts is unchanged (review P1-S-14)', async () => {
    await sql(`UPDATE "CaseParty" SET "litigantUserId" = $2, "eServiceAcceptedAt" = now(), facts = array_append(facts, 'E_SERVICE_ACCEPTED') WHERE "caseFileId" = $1 AND "displayName" = 'السيد جيم'`, [
      model.caseFileId,
      litigant.id,
    ]);
    const view = await viewAs(litigant, model.caseFileId);
    expect(view).not.toBeNull();
    expect(view!.parties.map((p) => [p.displayName, p.quality])).toEqual(MODEL_CASE.parties.map((p) => [p.name, p.quality ?? null]));
    for (const party of view!.parties.filter((p) => p.displayName !== 'السيد جيم')) {
      expect(party.idNumber ?? null).toBeNull();
      expect(party.addresses.filter((a) => a.kind === 'ELECTRONIC' || a.kind === 'PHONE')).toEqual([]);
    }
  });
});
