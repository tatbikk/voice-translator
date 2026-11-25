// Phase 2 demo data: the fictitious companies of the simulated commercial
// register (every answer carries «مصدر محاكى»), the professional data of the
// demo lawyers, and one filing whose defendant is a public establishment, filed
// through the platform's own path so that it is referred to the prosecution
// (art. 20). Every name, number and address is fictitious (prompt rule 11).

export interface RegisterEntrySeed {
  readonly key: string;
  readonly data: {
    readonly name: string;
    readonly legalForm: string;
    readonly legalRepresentative: string;
    readonly registeredOffice: string;
    readonly locality: string;
    readonly branch?: string;
    readonly email?: string;
  };
}

export const DEMO_REGISTER_ENTRIES: readonly RegisterEntrySeed[] = [
  {
    key: 'RC-DEMO-1001',
    data: {
      name: 'شركة ألف للتوريدات',
      legalForm: 'شركة ذات مسؤولية محدودة',
      legalRepresentative: 'السيد كاف ميم',
      registeredOffice: 'الدار البيضاء، شارع النموذج، رقم 1',
      locality: 'casablanca',
      email: 'contact@alif-demo.example',
    },
  },
  {
    key: 'RC-DEMO-2002',
    data: {
      name: 'شركة باء للصناعة',
      legalForm: 'شركة مساهمة',
      legalRepresentative: 'السيد جيم',
      registeredOffice: 'الدار البيضاء، المنطقة الصناعية النموذجية، رقم 2',
      locality: 'casablanca',
      branch: 'المحمدية، الحي الصناعي النموذجي، رقم 7',
    },
  },
  {
    key: 'RC-DEMO-3003',
    data: {
      name: 'شركة تاء للنقل',
      legalForm: 'شركة ذات مسؤولية محدودة',
      legalRepresentative: 'السيدة سين',
      registeredOffice: 'برشيد، شارع المثال، رقم 3',
      locality: 'berrechid',
      email: 'contact@taa-demo.example',
    },
  },
];

/** The professional data the check before signature reads (art. 77): number and bar. */
export const DEMO_BAR = { body: 'هيئة المحامين النموذجية', numbers: { 'lawyer.plaintiff': 'DEMO-A-0101', 'lawyer.defendants': 'DEMO-A-0202' } } as const;

/** A filing against a public establishment, made by the plaintiff's lawyer (art. 20, first case). */
export const DEMO_REFERRED_FILING = {
  caseType: '8201',
  defendantLocality: 'casablanca',
  card: {
    parties: [
      {
        key: 'taa',
        side: 'PLAINTIFF',
        personKind: 'LEGAL',
        name: 'شركة تاء للنقل',
        quality: 'مدعية',
        idNumber: 'RC-DEMO-3003',
        legalForm: 'شركة ذات مسؤولية محدودة',
        legalRepresentative: 'السيدة سين',
        registeredOffice: { value: 'برشيد، شارع المثال، رقم 3', locality: 'berrechid', source: 'COMMERCIAL_REGISTER' },
        email: 'contact@taa-demo.example',
        representedByFiler: true,
      },
      {
        key: 'office',
        side: 'DEFENDANT',
        personKind: 'PUBLIC',
        publicEntityKind: 'PUBLIC_ESTABLISHMENT',
        name: 'المكتب النموذجي للتجهيز',
        quality: 'مدعى عليه',
        legalRepresentative: 'مديره العام',
        registeredOffice: { value: 'الدار البيضاء، شارع المؤسسات النموذجي، رقم 9', locality: 'casablanca', source: 'DECLARED' },
      },
    ],
    summary: 'نقلت المدعية معدات لفائدة المدعى عليه بموجب صفقة نقل، ولم يؤد ثمن خدماتها البالغ 120.000 درهم رغم الإنذار. تلتمس الحكم بأداء المبلغ مع الفوائد القانونية والمصاريف.',
    claims: [
      { key: 'debt', nature: 'DEBT', amountCents: 12_000_000 },
      { key: 'interest', nature: 'LEGAL_INTEREST', amountCents: null },
      { key: 'costs', nature: 'COSTS', amountCents: null },
    ],
  },
  applicationText: [
    'مقال افتتاحي من أجل الأداء',
    'لفائدة: شركة تاء للنقل، شركة ذات مسؤولية محدودة، في شخص ممثلها القانوني.',
    'ضد: المكتب النموذجي للتجهيز، مؤسسة عمومية، في شخص مديره العام.',
    '1. الوقائع: نقلت المدعية معدات لفائدة المدعى عليه، وبقي ثمن خدماتها البالغ 120.000 درهم دون أداء.',
    '2. الطلبات: الحكم على المدعى عليه بأداء 120.000 درهم مع الفوائد القانونية والمصاريف.',
  ].join('\n'),
  exhibits: [
    { title: 'صفقة النقل', nature: 'ORIGINAL' },
    { title: 'الفاتورة', nature: 'CERTIFIED_COPY' },
  ],
} as const;
