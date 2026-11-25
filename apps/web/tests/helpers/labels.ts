// Every Arabic (and fr/zgh) label the end-to-end tests rely on, in one place,
// with the source of its wording, so that the author of the interface can
// align with it (or ask for a change here) in a single file.
//
// Sources:
//   contract  docs/phases/phase-0-contract.md (§4.1 role labels, §7 page titles, dashboard, top bar, §8 statuses)
//   plan      docs/phases/phase-0.md
//   study     docs/study.md («دفتر الواجهات»، «العناصر المشتركة»)
//   prompt    docs/build-prompt.md
//   proposed  no reference gives the wording: chosen on the study's model
//             (formal, impersonal); the interface may differ, then this file changes.
// Patterns are regular expressions where a small variation (a colon, a
// trailing mark of a required field) must not matter.

/** Page titles (contract §7, "Title (from the study/prompt)"); each page carries it in <title> and the <h1>. */
export const PAGE_TITLES = {
  access: 'كلمة عبور الزوار', // contract §7
  home: 'صفحة الاستقبال', // contract §7 (document title; the <h1> may be the wordmark)
  track: 'تتبع الملف', // contract §7, prompt
  hearings: 'جدول الجلسات', // contract §7, prompt
  environment: 'مكونات بيئة العرض', // contract §7, prompt rule 9
  login: 'الدخول', // contract §7, study «الدخول واختيار الصفة»
  loginConfirm: 'وسيلة التأكيد الثانية', // contract §7, study «وسيلة تأكيد ثانية»
  loginRole: 'اختيار الصفة', // contract §7, study
  activate: 'تفعيل الحساب', // contract §7
  dashboard: 'لوحة البداية', // contract §7, study
  notifications: 'الإشعارات', // contract §7
  account: 'الحساب الشخصي', // contract §7, study (fifth element of the top bar)
  reauth: 'إعادة التحقق من الهوية', // contract §7
  adminAccounts: 'الحسابات', // contract §7
  adminAccountsNew: 'إنشاء حساب', // contract §7
  demoOutbox: 'صندوق الرسائل الصادرة', // contract §7, prompt
  caseFile: 'صفحة الملف', // study «العناصر المشتركة» (Phase 1)
} as const;

export const WORDMARK = 'منصة المحكمة الرقمية'; // prompt rule 10, contract §7

/** Dashboard (contract §7, study «العناصر المشتركة», prompt «لغة الواجهة»). */
export const DASHBOARD = {
  boxes: ['ينتظر إجراء مني', 'آجال تقترب', 'جديد منذ آخر دخول'] as const, // study, contract §7
  emptyAwaiting: 'لا يوجد إجراء في انتظاركم.', // contract §7 (prompt: «لا يوجد إجراء في انتظاركم»)
} as const;

/** The case page (study «العناصر المشتركة», interface book). */
export const CASE_PAGE = {
  tabs: ['الخط الزمني', 'الوثائق', 'الأطراف', 'الطلبات', 'التبليغات', 'الآجال', 'الأداءات', 'المقررات'] as const, // study, the eight tabs
  actionsTitle: 'شريط الإجراءات', // study «شريط للإجراءات», glossary case.actionBar
  dispatch: 'تنفيذ', // study, «واجهة كتابة الضبط» (envelopes ready)
  challengeDeadline: 'أجل طلب تجريح الخبير', // case.deadlines.rule.EXPERT_CHALLENGE
  download: 'تنزيل', // linguistic review P1-L-02
} as const;

/** Top bar (contract §7). */
export const TOP_BAR = {
  logoSlot: 'موضع الشعار الرسمي', // prompt rule 10, contract §7
  demoIndicator: 'بيئة العرض', // prompt rule 9, contract §7
  notifications: /الإشعارات/, // contract §7 (bell); accessible name proposed
  language: /اللغة|اختيار اللغة/, // study «اختيار اللغة»; accessible name proposed
  readingEase: /تيسير القراءة/, // plan «أداة تيسير القراءة (حجم الخط والتباين)»
  readingLarger: /تكبير الخط|خط أكبر|حجم الخط/, // proposed (plan: «حجم الخط»)
  account: /الحساب الشخصي/, // study «الحساب الشخصي», contract §7 (account menu)
  logout: /الخروج|تسجيل الخروج/, // proposed
} as const;

/** Language names in the switcher, each in its own language (proposed). */
export const LANGUAGES = {
  ar: /العربية/,
  fr: /Français/i,
  zgh: /ⵜⴰⵎⴰⵣⵉⵖⵜ|Tamazight/i,
} as const;

/** The one-line notice that the translation is partial, in the selected language (contract §7; wording proposed). */
export const PARTIAL_TRANSLATION_NOTICE = {
  fr: /traduction/i,
} as const;

/** Forms (field names follow the API bodies of contract §6; wording proposed unless stated). */
export const FORMS = {
  access: {
    passphrase: /كلمة (ال)?عبور/, // prompt «كلمة عبور واحدة للزوار»; glossary «كلمة عبور الزوار»
    submit: /متابعة|دخول/, // proposed
  },
  login: {
    email: /البريد الإلكتروني/, // prompt «يدخل المستعمل ببريده»
    password: /كلمة السر/, // prompt «وكلمة سره»
    submit: /^الدخول$|^دخول$/, // study «الدخول»
  },
  confirm: {
    code: /رمز التأكيد|الرمز/, // prompt «رمز من ستة أرقام»
    // exact: the page also has «إعادة إرسال رمز التأكيد»
    submit: /^تأكيد الدخول$|^تأكيد$/,
  },
  role: {
    submit: /متابعة|اختيار|تأكيد/, // proposed (when the role is chosen by a radio button)
  },
  reauth: {
    password: /كلمة السر/,
    submit: /تأكيد|إعادة التحقق/, // proposed
  },
  track: {
    court: /المحكمة/, // prompt «واختيار المحكمة»
    number: /رقم الملف|الرقم/, // prompt «رقم الملف ورمزه وسنته»
    code: /الرمز/,
    year: /السنة/,
    submit: /بحث|تتبع/, // proposed
  },
  hearings: {
    court: /المحكمة/,
    date: /التاريخ|اليوم/, // proposed
    submit: /عرض|بحث/, // proposed
  },
  account: {
    fullName: /الاسم الكامل|الاسم/, // contract §6 body «fullName»
    email: /البريد الإلكتروني/,
    phone: /الهاتف/,
    role: /الصفة/, // study «الصفة»
    court: /المحكمة/,
    requestReference: /مرجع الطلب/, // memo row 10 «مرجع الطلب الموثق»
    submit: 'إنشاء حساب', // contract §7: «إنشاء حساب» submit opens the confirmation
    confirm: /تأكيد/, // proposed: the button that confirms inside the dialog
    cancel: /إلغاء|رجوع/, // proposed
  },
} as const;

/** Role labels (contract §4.1, values of roles.json from the study). */
export const ROLE_LABELS: Record<string, string> = {
  LAWYER: 'المحامي',
  LAWYER_ASSISTANT: 'مساعد مكتب المحاماة',
  CLERK_REGISTRATION: 'مكتب التقييد',
  CLERK_CASHIER: 'صندوق المحكمة',
  CLERK_NOTIFICATION: 'مكتب التبليغ',
  CLERK_HEARING: 'كاتب الجلسة',
  CLERK_COPIES_ENFORCEMENT: 'مكتب النسخ والتنفيذ',
  CHIEF_CLERK: 'رئيس كتابة الضبط',
  COURT_PRESIDENT: 'رئيس المحكمة',
  COURT_PRESIDENT_APPEAL: 'الرئيس الأول',
  JUDGE_RAPPORTEUR: 'القاضي المقرر',
  JUDGE_IN_CHARGE: 'القاضي المكلف بالقضية',
  COUNSELLOR_RAPPORTEUR: 'المستشار المقرر',
  PANEL_PRESIDENT: 'رئيس الهيئة',
  PANEL_MEMBER: 'عضو الهيئة',
  PUBLIC_PROSECUTOR: 'النيابة العامة',
  ROYAL_COMMISSIONER: 'المفوض الملكي للدفاع عن القانون والحق',
  BAILIFF: 'المفوض القضائي',
  EXPERT: 'الخبير',
  ENFORCEMENT_JUDGE: 'قاضي التنفيذ',
  LITIGANT: 'المتقاضي',
  PUBLIC_ADMIN_SUPERVISOR: 'المسؤول عن الحساب المؤسسي',
  PUBLIC_ADMIN_LITIGATION: 'موظف مصلحة المنازعات',
  STATE_JUDICIAL_AGENT: 'الوكيل القضائي للمملكة',
  GARNISHEE_BANK: 'البنك المحجوز لديه',
  SYSTEM_ADMIN: 'مدبر النظام',
  RULES_LEGAL_VALIDATOR: 'المختص القانوني المصادق على القواعد',
};

/** Case statuses (contract §8). */
export const STATUS_LABELS: Record<string, string> = {
  FILED: 'مودع',
  REGISTERED: 'مقيد', // the law's term prevails over the contract's «مسجل» (docs/decisions.md, decision 21)
  RAPPORTEUR_ASSIGNED: 'معين مقرره',
  IN_NOTIFICATION: 'في التبليغ',
  IN_PREPARATION: 'في التجهيز',
  IN_EXPERTISE: 'في الخبرة',
  READY: 'جاهز',
  IN_DELIBERATION: 'في المداولة',
  JUDGMENT_ISSUED: 'صدر الحكم',
  UNDER_APPEAL: 'مطعون فيه',
  IN_ENFORCEMENT: 'في التنفيذ',
  CLOSED: 'منته',
};

/** Text that only the administration pages show (to prove a 404 page leaks none of it). */
export const ADMIN_ONLY_TEXT = [PAGE_TITLES.adminAccounts, PAGE_TITLES.adminAccountsNew, 'مرجع الطلب'] as const;

/** The landmark of the demo tools bar (contract §9: "its own landmark aria-label"; wording proposed). */
export const DEMO_BAR = /أدوات العرض/;

/** The 26 roles of contract §4.1 (the e2e suite does not import the core). */
export const ROLE_CODES_E2E: readonly string[] = Object.keys(ROLE_LABELS).filter((code) => code !== 'COURT_PRESIDENT_APPEAL');

/** The language control, whatever the current language (fr «Langue», zgh «ⵜⵓⵜⵍⴰⵢⵜ»: proposed). */
export const LANGUAGE_CONTROL = /اللغة|Langue|ⵜⵓⵜⵍⴰⵢⵜ/i;
