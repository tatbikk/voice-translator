// The content of the six demo case files (Phase 1): parties, counsel, claims,
// and the station each file has reached. Every name is fictitious, in the
// study's lettered manner (rule 11); every address and identifier is invented.
// The model case itself is not here: Phase 2 files it from the first screen.

export type DemoSide = 'PLAINTIFF' | 'DEFENDANT' | 'GUARANTOR' | 'APPELLANT' | 'RESPONDENT';

export interface DemoParty {
  readonly key: string;
  readonly side: DemoSide;
  readonly personKind: 'NATURAL' | 'LEGAL';
  readonly name: string;
  readonly legalForm?: string;
  readonly address: string;
  readonly addressSource: 'DECLARED' | 'COMMERCIAL_REGISTER';
  readonly counsel?: 'lawyer.plaintiff' | 'lawyer.defendants';
  /** the party is the demo litigant, who accepted electronic service */
  readonly litigant?: boolean;
}

export interface DemoClaim {
  readonly party: string;
  readonly category: 'PRINCIPAL' | 'COUNTER';
  readonly nature: 'DEBT' | 'DAMAGES' | 'LEGAL_INTEREST' | 'PROVISIONAL_ENFORCEMENT' | 'COSTS';
  readonly dirhams: number | null;
}

export interface DemoCaseContent {
  readonly number: number;
  readonly caseType: 'COMMERCIAL_PAYMENT' | 'COMMERCIAL_DAMAGES' | 'APPEAL_COMMERCIAL';
  readonly subject: string;
  readonly rapporteur: string | null;
  readonly panel: 'fiFirst' | 'fiSecond' | 'apFirst';
  readonly parties: readonly DemoParty[];
  readonly claims: readonly DemoClaim[];
  /** «ينوب عنها … بصفتها مدعى عليها», agreed with the number of defendants (judgment only) */
  readonly defendantsQuality?: string;
}

const sarl = 'شركة ذات مسؤولية محدودة';
const sa = 'شركة مساهمة';

export const DEMO_CASE_CONTENT: readonly DemoCaseContent[] = [
  {
    number: 1201,
    caseType: 'COMMERCIAL_PAYMENT',
    subject: 'أداء ثمن مواد بناء',
    rapporteur: null,
    panel: 'fiFirst',
    parties: [
      { key: 'p', side: 'PLAINTIFF', personKind: 'LEGAL', name: 'شركة حاء للبناء', legalForm: sarl, address: 'الدار البيضاء، زنقة النموذج، رقم 12', addressSource: 'COMMERCIAL_REGISTER', counsel: 'lawyer.plaintiff' },
      { key: 'd', side: 'DEFENDANT', personKind: 'LEGAL', name: 'شركة طاء للتجهيز', legalForm: sarl, address: 'الدار البيضاء، شارع المثال، رقم 40', addressSource: 'DECLARED' },
    ],
    claims: [
      { party: 'p', category: 'PRINCIPAL', nature: 'DEBT', dirhams: 125_000 },
      { party: 'p', category: 'PRINCIPAL', nature: 'LEGAL_INTEREST', dirhams: null },
      { party: 'p', category: 'PRINCIPAL', nature: 'COSTS', dirhams: null },
    ],
  },
  {
    number: 1188,
    caseType: 'COMMERCIAL_PAYMENT',
    subject: 'أداء ثمن بضاعة موزعة',
    rapporteur: 'judge.rapporteur',
    panel: 'fiFirst',
    parties: [
      { key: 'p', side: 'PLAINTIFF', personKind: 'LEGAL', name: 'شركة ياء للتوزيع', legalForm: sa, address: 'الدار البيضاء، زنقة المثال، رقم 3', addressSource: 'COMMERCIAL_REGISTER', counsel: 'lawyer.plaintiff' },
      { key: 'd', side: 'DEFENDANT', personKind: 'NATURAL', name: 'السيد ثاء دال', address: 'المحمدية، حي النموذج، رقم 7', addressSource: 'DECLARED' },
    ],
    claims: [
      { party: 'p', category: 'PRINCIPAL', nature: 'DEBT', dirhams: 92_000 },
      { party: 'p', category: 'PRINCIPAL', nature: 'DAMAGES', dirhams: 8_000 },
    ],
  },
  {
    number: 1150,
    caseType: 'COMMERCIAL_PAYMENT',
    subject: 'أداء ثمن أقمشة',
    rapporteur: 'judge.rapporteur',
    panel: 'fiSecond',
    parties: [
      { key: 'p', side: 'PLAINTIFF', personKind: 'LEGAL', name: 'شركة لام للنسيج', legalForm: sarl, address: 'الدار البيضاء، شارع النموذج، رقم 18', addressSource: 'COMMERCIAL_REGISTER', counsel: 'lawyer.plaintiff' },
      { key: 'd', side: 'DEFENDANT', personKind: 'LEGAL', name: 'شركة ميم للخدمات', legalForm: sarl, address: 'الدار البيضاء، زنقة المثال، رقم 55', addressSource: 'COMMERCIAL_REGISTER', counsel: 'lawyer.defendants' },
    ],
    claims: [
      { party: 'p', category: 'PRINCIPAL', nature: 'DEBT', dirhams: 210_000 },
      { party: 'd', category: 'COUNTER', nature: 'DAMAGES', dirhams: 30_000 },
    ],
  },
  {
    number: 1103,
    caseType: 'COMMERCIAL_PAYMENT',
    subject: 'أداء ثمن معدات تبريد',
    rapporteur: 'judge.rapporteur',
    panel: 'fiFirst',
    parties: [
      { key: 'p', side: 'PLAINTIFF', personKind: 'LEGAL', name: 'شركة نون للأغذية', legalForm: sa, address: 'الدار البيضاء، شارع المثال، رقم 9', addressSource: 'COMMERCIAL_REGISTER', counsel: 'lawyer.plaintiff' },
      { key: 'd', side: 'DEFENDANT', personKind: 'LEGAL', name: 'شركة سين للتبريد', legalForm: sarl, address: 'برشيد، المنطقة الصناعية النموذجية، رقم 2', addressSource: 'COMMERCIAL_REGISTER', counsel: 'lawyer.defendants' },
    ],
    claims: [
      { party: 'p', category: 'PRINCIPAL', nature: 'DEBT', dirhams: 340_000 },
      { party: 'p', category: 'PRINCIPAL', nature: 'LEGAL_INTEREST', dirhams: null },
    ],
  },
  {
    number: 1067,
    caseType: 'COMMERCIAL_DAMAGES',
    subject: 'تعويض عن إخلال بعقد توريد',
    rapporteur: 'judge.rapporteur',
    panel: 'fiSecond',
    parties: [
      { key: 'p', side: 'PLAINTIFF', personKind: 'LEGAL', name: 'شركة عين للمعادن', legalForm: sa, address: 'الدار البيضاء، زنقة النموذج، رقم 30', addressSource: 'COMMERCIAL_REGISTER', counsel: 'lawyer.plaintiff' },
      { key: 'd', side: 'DEFENDANT', personKind: 'LEGAL', name: 'شركة فاء للتصدير', legalForm: sarl, address: 'الدار البيضاء، شارع المثال، رقم 71', addressSource: 'COMMERCIAL_REGISTER', counsel: 'lawyer.defendants' },
    ],
    claims: [{ party: 'p', category: 'PRINCIPAL', nature: 'DAMAGES', dirhams: 150_000 }],
    defendantsQuality: 'ينوب عنها الأستاذ هاء، بصفتها مدعى عليها',
  },
  {
    number: 980,
    caseType: 'COMMERCIAL_PAYMENT',
    subject: 'أداء ثمن أثاث مكتبي',
    rapporteur: 'judge.rapporteur',
    panel: 'fiFirst',
    parties: [
      { key: 'p', side: 'PLAINTIFF', personKind: 'LEGAL', name: 'شركة صاد للأثاث', legalForm: sarl, address: 'الدار البيضاء، زنقة المثال، رقم 14', addressSource: 'COMMERCIAL_REGISTER', counsel: 'lawyer.plaintiff' },
      { key: 'd', side: 'DEFENDANT', personKind: 'LEGAL', name: 'شركة قاف للتجارة', legalForm: sarl, address: 'الدار البيضاء، شارع النموذج، رقم 88', addressSource: 'COMMERCIAL_REGISTER', counsel: 'lawyer.defendants' },
      { key: 'g', side: 'GUARANTOR', personKind: 'NATURAL', name: 'السيد جيم', address: 'الدار البيضاء، حي المثال، رقم 5', addressSource: 'DECLARED', counsel: 'lawyer.defendants', litigant: true },
    ],
    claims: [
      { party: 'p', category: 'PRINCIPAL', nature: 'DEBT', dirhams: 300_000 },
      { party: 'p', category: 'PRINCIPAL', nature: 'LEGAL_INTEREST', dirhams: null },
      { party: 'p', category: 'PRINCIPAL', nature: 'COSTS', dirhams: null },
    ],
    defendantsQuality: 'ينوب عنهما الأستاذ هاء، بصفتهما مدعى عليهما',
  },
  {
    number: 312,
    caseType: 'APPEAL_COMMERCIAL',
    subject: 'استئناف حكم في أداء ثمن خدمات نقل',
    rapporteur: 'counsellor.rapporteur',
    panel: 'apFirst',
    parties: [
      { key: 'a', side: 'APPELLANT', personKind: 'LEGAL', name: 'شركة راء للتأمين', legalForm: sa, address: 'الرباط، شارع النموذج، رقم 6', addressSource: 'COMMERCIAL_REGISTER', counsel: 'lawyer.defendants' },
      { key: 'r', side: 'RESPONDENT', personKind: 'LEGAL', name: 'شركة شين للنقل', legalForm: sarl, address: 'الدار البيضاء، زنقة المثال، رقم 21', addressSource: 'COMMERCIAL_REGISTER', counsel: 'lawyer.plaintiff' },
    ],
    claims: [{ party: 'a', category: 'PRINCIPAL', nature: 'DEBT', dirhams: 150_000 }],
  },
];

/** The demo texts of deposited and generated documents (data, not code). */
export const DEMO_TEXTS = {
  applicationTitle: 'المقال الافتتاحي',
  exhibitTitle: 'الفواتير وسندات التسليم',
  briefTitle: 'مذكرة جوابية',
  appealTitle: 'مقال الاستئناف',
  summonsTitle: 'أمر بالاستدعاء وتبليغ المقال الافتتاحي',
  expertiseTitle: 'أمر بإجراء خبرة حسابية',
  judgmentTitle: 'حكم',
  basis: 'المواد {articles} من القانون رقم 58.25 المتعلق بالمسطرة المدنية',
  articleJoiner: ' و',
  nameJoiner: ' و',
  summons: 'باستدعاء الأطراف لجلسة {date}، وتبليغ نسخة من المقال الافتتاحي إلى المدعى عليه، مع الإشارة إلى وجوب تقديم مذكرات الدفاع والمستندات قبل الجلسة.',
  expertise: 'بإجراء خبرة حسابية يعهد بها إلى الخبير السيد تاء، لتحديد المبالغ المؤداة فعلا ورصيد الحساب بين الطرفين.',
  deposit: 'وبإيداع مبلغ 8.000,00 درهم بصندوق المحكمة من طرف المدعية داخل أجل خمسة عشر يوما من تاريخ تبليغ هذا الأمر.',
  facts: [
    'تقدمت المدعية بمقال افتتاحي تعرض فيه أنها وردت للمدعى عليها بضاعة بقيت فواتيرها دون أداء، والتمست الحكم بأداء أصل الدين مع الفوائد القانونية والمصاريف.',
    'وأجابت المدعى عليها بمذكرة نازعت فيها في جزء من المبلغ، وأدلى الطرفان بمستنداتهما، وحجزت القضية للمداولة.',
  ],
  reasoning: ['حيث ثبت للمحكمة من الفواتير وسندات التسليم المدلى بها أن المدعى عليها توصلت بالبضاعة ولم تثبت أداء ثمنها.'],
  operative: ['تحكم المحكمة علنيا ابتدائيا وحضوريا بأداء المدعى عليها لفائدة المدعية أصل الدين مع الفوائد القانونية من تاريخ الطلب، وتحميلها المصاريف.'],
} as const;
