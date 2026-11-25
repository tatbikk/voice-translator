// Runs packages/core/rules-tests/referrals.md against the referral rules
// (rules/referrals.json, rules/case-types.json) and the check before signature.
import { describe, expect, it } from 'vitest';
import {
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

const ON = '2026-11-25';
const referralRules = ruleInForce(readRules<ReferralRuleSet[]>('referrals.json'), ON)!;
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
