// Runs packages/core/rules-tests/referrals.md against the referral rules
// (rules/referrals.json, rules/case-types.json) and the check before signature.
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_ENTITY_KINDS,
  preSignatureChecks,
  referralsFor,
  ruleInForce,
  type CaseTypeRuleSet,
  type ClaimNature,
  type FilingCard,
  type JurisdictionRuleSet,
  type ReferralRuleSet,
} from '../../src/index';
import { readRules, rows } from './md-tables';

// The day the table that communicates every public-law person takes effect (decision 66).
const ON = '2026-11-26';
const referralTables = readRules<ReferralRuleSet[]>('referrals.json');
const referralRules = ruleInForce(referralTables, ON)!;
const caseTypes = ruleInForce(readRules<CaseTypeRuleSet[]>('case-types.json'), ON)!;
const jurisdiction = ruleInForce(readRules<JurisdictionRuleSet[]>('jurisdiction.json'), ON)!;
const typeOf = (code: string) => caseTypes.types.find((t) => t.code === code) ?? null;

const SPECIALTIES = { تجارية: 'COMMERCIAL', عادية: 'GENERAL', إدارية: 'ADMINISTRATIVE' } as const;
const SIDES = { مدع: 'PLAINTIFF', 'مدعى عليه': 'DEFENDANT', كفيل: 'GUARANTOR' } as const;
const KINDS: Record<string, Partial<FilingCard['parties'][number]>> = {
  شركة: { personKind: 'LEGAL' },
  'شخص ذاتي': { personKind: 'NATURAL' },
  'شخص ذاتي ناقص الأهلية': { personKind: 'NATURAL', capacityStatus: 'INCAPABLE' },
  'شخص ذاتي غائب': { personKind: 'NATURAL', capacityStatus: 'ABSENT' },
  الدولة: { personKind: 'PUBLIC', publicEntityKind: 'STATE' },
  'جماعة ترابية': { personKind: 'PUBLIC', publicEntityKind: 'LOCAL_AUTHORITY' },
  'مؤسسة عمومية': { personKind: 'PUBLIC', publicEntityKind: 'PUBLIC_ESTABLISHMENT' },
  'شخص آخر من أشخاص القانون العام': { personKind: 'PUBLIC', publicEntityKind: 'OTHER_PUBLIC' },
  'الوكيل القضائي للمملكة': { personKind: 'PUBLIC', publicEntityKind: 'STATE_JUDICIAL_AGENT' },
  'الوكيل القضائي للجماعات الترابية': { personKind: 'PUBLIC', publicEntityKind: 'LOCAL_AUTHORITIES_AGENT' },
  // the category left on the form's empty choice
  'شخص من أشخاص القانون العام لم يبين صنفه': { personKind: 'PUBLIC' },
};
const NATURES: Record<string, ClaimNature> = { دين: 'DEBT', تعويض: 'DAMAGES', 'فوائد قانونية': 'LEGAL_INTEREST', 'تنفيذ معجل': 'PROVISIONAL_ENFORCEMENT', مصاريف: 'COSTS' };

function parties(cell: string): FilingCard['parties'] {
  return cell.split('؛').map((part, i) => {
    const text = part.trim();
    const side = (Object.keys(SIDES) as (keyof typeof SIDES)[]).sort((a, b) => b.length - a.length).find((s) => text.startsWith(`${s} `));
    if (!side) throw new Error(`unknown side: ${text}`);
    const kind = KINDS[text.slice(side.length + 1)];
    if (!kind) throw new Error(`unknown party kind: ${text}`);
    return { key: `p${String(i)}`, side: SIDES[side], name: `طرف ${String(i)}`, personKind: 'LEGAL', ...kind };
  });
}

function claims(cell: string): FilingCard['claims'] {
  return cell.split('؛').map((part, i) => {
    const words = part.trim().split(' ');
    const last = words.at(-1) ?? '';
    const amount = /^\d+$/.test(last) ? Number(last) * 100 : null;
    const nature = NATURES[(amount === null ? words : words.slice(0, -1)).join(' ')];
    if (!nature) throw new Error(`unknown claim: ${part}`);
    return { key: `c${String(i)}`, nature, amountCents: amount };
  });
}

function describeReferrals(list: ReturnType<typeof referralsFor>): string {
  if (list.length === 0) return 'لا إحالة';
  return list
    .map((r) => {
      if (r.target === 'ROYAL_COMMISSIONER') return `المفوض الملكي، نسخة المقال، المادة ${String(r.article)}`;
      const ground = r.ground === 'PRINCIPAL_PARTY' ? 'طرف أصلي' : 'تبليغ';
      return `النيابة العامة، ${ground}، المادة ${String(r.article)}، الحالة ${String(r.item)}`;
    })
    .join('؛ ');
}

describe('automatic referrals in plain language', () => {
  for (const [caseText = '', court = '', code = '', partiesCell = '', expected = ''] of rows('referrals.md', 'الإحالة عند التقييد')) {
    it(caseText, () => {
      const specialty = SPECIALTIES[court as keyof typeof SPECIALTIES];
      const found = referralsFor({ courtSpecialty: specialty, caseType: typeOf(code), parties: parties(partiesCell), rules: referralRules });
      expect(describeReferrals(found)).toBe(expected);
    });
  }
});

// Independent review IR-01: art. 20, item 1 names «أي شخص آخر من أشخاص القانون العام». The
// communication is due for any public-law person, and the table says so, not the code.
describe('art. 20, item 1: any public-law person, whatever its category (independent review IR-01)', () => {
  const company = { personKind: 'LEGAL' } as const;
  const communicated = [{ target: 'PROSECUTION', ground: 'COMMUNICATION', article: 20, item: 1, reasonCode: 'PUBLIC_PARTY' }];

  it('communicates the case for every category the card offers, and for none', () => {
    for (const publicEntityKind of [undefined, ...PUBLIC_ENTITY_KINDS]) {
      for (const parties of [
        [company, { personKind: 'PUBLIC' as const, publicEntityKind }],
        [{ personKind: 'PUBLIC' as const, publicEntityKind }, company],
      ]) {
        const found = referralsFor({ courtSpecialty: 'COMMERCIAL', caseType: typeOf('8201'), parties, rules: referralRules });
        expect(found, publicEntityKind ?? 'no category').toEqual(communicated);
      }
    }
  });

  it('communicates once, however many public-law persons the file has', () => {
    const parties = [{ personKind: 'PUBLIC' as const }, { personKind: 'PUBLIC' as const, publicEntityKind: 'STATE_JUDICIAL_AGENT' as const }, company];
    expect(referralsFor({ courtSpecialty: 'COMMERCIAL', caseType: typeOf('8201'), parties, rules: referralRules })).toEqual(communicated);
  });

  it('communicates nothing for a category kept on a person who is not a public-law person', () => {
    const parties = [company, { personKind: 'LEGAL' as const, publicEntityKind: 'STATE' as const }];
    expect(referralsFor({ courtSpecialty: 'COMMERCIAL', caseType: typeOf('8201'), parties, rules: referralRules })).toEqual([]);
  });

  it('reads the rule from the dated table: the version in force before listed four categories and missed the others', () => {
    const before = ruleInForce(referralTables, '2026-11-25')!;
    expect(before.version).not.toBe(referralRules.version);
    expect(before.validTo).toBe(referralRules.validFrom);
    const uncategorised = [company, { personKind: 'PUBLIC' as const }];
    expect(referralsFor({ courtSpecialty: 'COMMERCIAL', caseType: typeOf('8201'), parties: uncategorised, rules: before })).toEqual([]);
    expect(referralsFor({ courtSpecialty: 'COMMERCIAL', caseType: typeOf('8201'), parties: uncategorised, rules: referralRules })).toEqual(communicated);
    // The table in force names the item for any public-law person and for each category.
    const communication = referralRules.prosecution.communication as typeof referralRules.prosecution.communication & { anyPublicLawPerson?: number };
    expect(communication.anyPublicLawPerson).toBe(1);
    for (const kind of PUBLIC_ENTITY_KINDS) expect(communication.publicEntityKinds[kind], kind).toBe(1);
  });
});

describe('the judicial agent warning in plain language (art. 605)', () => {
  for (const [caseText = '', code = '', partiesCell = '', claimsCell = '', expected = ''] of rows('referrals.md', 'التنبيه إلى إدخال الوكيل القضائي (م 605)')) {
    it(caseText, () => {
      const card: FilingCard = { parties: parties(partiesCell), summary: 'موجز', claims: claims(claimsCell) };
      const checks = preSignatureChecks({
        channel: 'ELECTRONIC',
        card,
        attested: ['PLAINTIFFS', 'DEFENDANTS', 'SUMMARY', 'CLAIMS'],
        application: { present: true, fixedCopyReady: true },
        documents: [],
        filer: { professionalNumber: 'X', professionalBody: 'Y', email: 'z@example.test' },
        caseType: typeOf(code),
        courtSpecialty: 'COMMERCIAL',
        referrals: referralRules,
        jurisdiction,
      });
      const agent = checks.filter((c) => c.code === 'STATE_JUDICIAL_AGENT_MISSING' || c.code === 'LOCAL_AUTHORITIES_AGENT_MISSING');
      const text = agent.length === 0 ? 'لا تنبيه' : agent.map((c) => (c.code === 'STATE_JUDICIAL_AGENT_MISSING' ? 'الوكيل القضائي للمملكة' : 'الوكيل القضائي للجماعات الترابية')).join('؛ ');
      expect(text).toBe(expected);
      for (const c of agent) {
        expect(c.level).toBe('WARNING');
        expect(c.article).toBe(605);
      }
    });
  }
});
