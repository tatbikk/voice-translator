// The model case as its plaintiff's lawyer enters it in «بطاقة الدعوى»
// (study, «المرحلة الأولى»; docs/phases/phase-2.md). Every name, number and
// address is fictitious (prompt rule 11). The shape is the case card of the
// core (packages/core/src/filing/card.ts); the tests send it as is.

export type CardSide = 'PLAINTIFF' | 'DEFENDANT' | 'GUARANTOR';
export type CardPersonKind = 'NATURAL' | 'LEGAL' | 'PUBLIC';

export interface CardAddress {
  readonly value: string;
  /** the code of a locality of the districts table (rules/districts.json), when known */
  readonly locality?: string;
  /** the country of an address outside the Kingdom (art. 89), never with a locality */
  readonly country?: string;
  readonly source: 'DECLARED' | 'COMMERCIAL_REGISTER';
}

export interface CardParty {
  readonly key: string;
  readonly side: CardSide;
  readonly personKind: CardPersonKind;
  readonly name: string;
  /** the party's capacity in the suit (art. 77: «صفة») */
  readonly quality?: string;
  /** national identity card of a natural person, or trade register number */
  readonly idNumber?: string;
  readonly legalForm?: string;
  readonly legalRepresentative?: string;
  readonly publicEntityKind?: 'STATE' | 'LOCAL_AUTHORITY' | 'PUBLIC_ESTABLISHMENT' | 'OTHER_PUBLIC' | 'STATE_JUDICIAL_AGENT' | 'LOCAL_AUTHORITIES_AGENT';
  readonly capacityStatus?: 'FULL' | 'INCAPABLE' | 'ABSENT';
  readonly domicile?: CardAddress;
  readonly residence?: CardAddress;
  readonly registeredOffice?: CardAddress;
  readonly branch?: CardAddress;
  readonly email?: string;
  readonly phone?: string;
  readonly agent?: { readonly name: string; readonly address: string };
  /** the filing lawyer acts for this party */
  readonly representedByFiler?: boolean;
}

export interface CardClaim {
  readonly key: string;
  readonly nature: 'DEBT' | 'DAMAGES' | 'LEGAL_INTEREST' | 'PROVISIONAL_ENFORCEMENT' | 'COSTS' | 'OTHER';
  /** centimes, or null for a claim without a fixed amount */
  readonly amountCents: number | null;
  readonly description?: string;
}

export interface Card {
  readonly parties: readonly CardParty[];
  readonly summary: string;
  readonly claims: readonly CardClaim[];
}

/** The four sections the depositor attests «مطابق للمقال». */
export const CARD_SECTIONS = ['PLAINTIFFS', 'DEFENDANTS', 'SUMMARY', 'CLAIMS'] as const;

/** Case-type code of a commercial payment claim in rules/case-types.json (fictitious codes, س21). */
export const COMMERCIAL_PAYMENT = '8201';

export const MODEL_CASE: Card = {
  parties: [
    {
      key: 'alif',
      side: 'PLAINTIFF',
      personKind: 'LEGAL',
      name: 'شركة ألف للتوريدات',
      quality: 'مدعية',
      idNumber: 'RC-DEMO-1001',
      legalForm: 'شركة ذات مسؤولية محدودة',
      legalRepresentative: 'السيد كاف ميم',
      registeredOffice: { value: 'الدار البيضاء، شارع النموذج، رقم 1', locality: 'casablanca', source: 'COMMERCIAL_REGISTER' },
      email: 'contact@alif-demo.example',
      representedByFiler: true,
    },
    {
      key: 'baa',
      side: 'DEFENDANT',
      personKind: 'LEGAL',
      name: 'شركة باء للصناعة',
      quality: 'مدعى عليها',
      idNumber: 'RC-DEMO-2002',
      legalForm: 'شركة مساهمة',
      legalRepresentative: 'السيد جيم',
      registeredOffice: { value: 'الدار البيضاء، المنطقة الصناعية النموذجية، رقم 2', locality: 'casablanca', source: 'COMMERCIAL_REGISTER' },
      // no e-mail address: the check before signature warns about it (study, «مراقبة البيانات الإلزامية»)
    },
    {
      key: 'jim',
      side: 'GUARANTOR',
      personKind: 'NATURAL',
      name: 'السيد جيم',
      quality: 'كفيل متضامن',
      domicile: { value: 'الدار البيضاء، حي المثال، رقم 5', locality: 'casablanca', source: 'DECLARED' },
    },
  ],
  summary:
    'وردت المدعية أثوابا إلى المدعى عليها بموجب عقد توريد، وبقيت ست فواتير بمبلغ إجمالي قدره 486.000 درهم دون أداء، ووقع مسيرها كفالة تضامنية لضمان ديونها. تلتمس المدعية الحكم على المدعى عليها وكفيلها بالتضامن بأداء أصل الدين مع الفوائد القانونية، وتعويض عن التماطل، مع التنفيذ المعجل وتحميلهما المصاريف.',
  claims: [
    { key: 'debt', nature: 'DEBT', amountCents: 48_600_000 },
    { key: 'interest', nature: 'LEGAL_INTEREST', amountCents: null },
    { key: 'damages', nature: 'DAMAGES', amountCents: 4_000_000 },
    { key: 'enforcement', nature: 'PROVISIONAL_ENFORCEMENT', amountCents: null },
    { key: 'costs', nature: 'COSTS', amountCents: null },
  ],
};

/** 526.000 dirhams of claims with a fixed amount: 5.570 dirhams (study; the 1% band is uncertain, س9). */
export const MODEL_CASE_FEE_CENTS = 557_000;

/** The model case's exhibits (study): title and declared nature (art. 631). */
export const MODEL_CASE_EXHIBITS: readonly { title: string; nature: 'ORIGINAL' | 'CERTIFIED_COPY' | 'PHOTOCOPY' }[] = [
  { title: 'عقد التوريد', nature: 'ORIGINAL' },
  { title: 'الفواتير الست', nature: 'CERTIFIED_COPY' },
  { title: 'سندات التسليم', nature: 'PHOTOCOPY' },
  { title: 'عقد الكفالة', nature: 'ORIGINAL' },
  { title: 'الإنذار مع محضر تبليغه', nature: 'CERTIFIED_COPY' },
  { title: 'مستخرج السجل التجاري', nature: 'ORIGINAL' },
];

/** The application, pasted (the editor keeps paragraphs and their numbering). */
export const MODEL_CASE_APPLICATION_TEXT = [
  'مقال افتتاحي من أجل الأداء',
  'لفائدة: شركة ألف للتوريدات، شركة ذات مسؤولية محدودة، في شخص ممثلها القانوني.',
  'ضد: شركة باء للصناعة، شركة مساهمة، في شخص ممثلها القانوني؛ والسيد جيم، بصفته كفيلا متضامنا.',
  '1. الوقائع: وردت المدعية أثوابا إلى المدعى عليها بموجب عقد توريد، وبقيت ست فواتير بمبلغ إجمالي قدره 486.000 درهم دون أداء.',
  '2. الأسباب: الدين ثابت بالفواتير وسندات التسليم، والكفالة التضامنية ثابتة بعقدها.',
  '3. الطلبات: الحكم على المدعى عليهما بالتضامن بأدائهما 486.000 درهم مع الفوائد القانونية، وتعويض قدره 40.000 درهم، مع التنفيذ المعجل والمصاريف.',
].join('\n');

/**
 * A second filing whose defendant is a public establishment: it is referred to
 * the prosecution on registration (art. 20, first case), and the check before
 * signature warns that the State judicial agent is not a party (art. 605).
 */
export const PUBLIC_DEFENDANT_CASE: Card = {
  parties: [MODEL_CASE.parties[0]!],
  summary: 'دعوى أداء ثمن توريدات لم يؤد، ضد مؤسسة عمومية.',
  claims: [
    { key: 'debt', nature: 'DEBT', amountCents: 12_000_000 },
    { key: 'costs', nature: 'COSTS', amountCents: null },
  ],
} satisfies Card;

export const PUBLIC_ESTABLISHMENT: CardParty = {
  key: 'office',
  side: 'DEFENDANT',
  personKind: 'PUBLIC',
  publicEntityKind: 'PUBLIC_ESTABLISHMENT',
  name: 'المكتب النموذجي للتجهيز',
  quality: 'مدعى عليه',
  legalRepresentative: 'مديره العام',
  registeredOffice: { value: 'الدار البيضاء، شارع المثال، رقم 100', locality: 'casablanca', source: 'DECLARED' },
  email: 'contentieux@office-demo.example',
};

/**
 * The same public-law defendant with its category left on the form's empty choice: the card is
 * saved, the payment and the filing are refused until the category is given (decision 66;
 * independent review IR-01).
 */
export const PUBLIC_PERSON_WITHOUT_KIND: CardParty = {
  key: 'office',
  side: 'DEFENDANT',
  personKind: 'PUBLIC',
  name: 'المكتب النموذجي للتجهيز',
  quality: 'مدعى عليه',
  legalRepresentative: 'مديره العام',
  registeredOffice: { value: 'الدار البيضاء، شارع المثال، رقم 100', locality: 'casablanca', source: 'DECLARED' },
  email: 'contentieux@office-demo.example',
};

/**
 * The State judicial agent as the only public party of a file: the case is communicated to the
 * prosecution all the same (art. 20, first case; independent review IR-01). Fictitious address.
 */
export const STATE_JUDICIAL_AGENT: CardParty = {
  key: 'agent',
  side: 'DEFENDANT',
  personKind: 'PUBLIC',
  publicEntityKind: 'STATE_JUDICIAL_AGENT',
  name: 'الوكيل القضائي للمملكة',
  quality: 'مدعى عليه',
  registeredOffice: { value: 'الرباط، شارع المثال، رقم 200', source: 'DECLARED' },
  email: 'contentieux@agent-demo.example',
};

/**
 * A second plaintiff who keeps counsel of his own: the filing lawyer unticks «ينوب المحامي المودع
 * عن هذا الطرف» under him and remains counsel of the first plaintiff (decision 67; independent
 * review IR-02). Fictitious name, number and address.
 */
export const SECOND_PLAINTIFF: CardParty = {
  key: 'dal',
  side: 'PLAINTIFF',
  personKind: 'NATURAL',
  name: 'السيد دال',
  quality: 'مدع',
  idNumber: 'DEMO-CIN-0009',
  domicile: { value: 'الدار البيضاء، حي المثال، رقم 9', locality: 'casablanca', source: 'DECLARED' },
  representedByFiler: false,
};

/**
 * The same card with the box «ينوب المحامي المودع عن هذا الطرف» as `box` gives it for each party;
 * undefined leaves the field out, as a client that never sends it.
 */
export function withCounselBox(card: Card, box: (party: CardParty) => boolean | undefined): Card {
  return {
    ...card,
    parties: card.parties.map((party) => {
      const { representedByFiler: _previous, ...rest } = party;
      const value = box(party);
      return value === undefined ? rest : { ...rest, representedByFiler: value };
    }),
  };
}

export function withParties(card: Card, extra: readonly CardParty[]): Card {
  return { ...card, parties: [...card.parties, ...extra] };
}

/** The same card with other claims (independent review IR-03, IR-04, IR-26). */
export function withClaims(card: Card, claims: readonly CardClaim[]): Card {
  return { ...card, claims };
}

/**
 * A debt whose amount was left empty, and «طلب آخر» without amount: neither is outside the base
 * by rule, and the fee of a claim of undetermined value is an open question (س41). Each has a
 * line of its own in the fee, marked «قيمة مؤقتة غير مؤكدة».
 */
export const UNVALUED_DEBT: CardClaim = { key: 'debt', nature: 'DEBT', amountCents: null };
export const UNVALUED_OTHER: CardClaim = { key: 'other', nature: 'OTHER', amountCents: null, description: 'فسخ عقد التوريد' };

/** A claim the fee table puts outside the base (study): alone, it calls for the pleading fee only, which is settled. */
export const ENFORCEMENT_ONLY: CardClaim = { key: 'enforcement', nature: 'PROVISIONAL_ENFORCEMENT', amountCents: null };

/** The pleading fee: 10 dirhams (study, «المرحلة الأولى»). */
export const PLEADING_FEE_CENTS = 1_000;
