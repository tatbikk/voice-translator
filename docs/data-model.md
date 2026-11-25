# نموذج البيانات

يعرض هذا الملف مخطط قاعدة المعطيات قبل إنشاء هجراتها، كما يشترط البرومبت في باب «نموذج البيانات». وهو يغطي في المرحلة 0 ما تحتاجه الهوية والجلسات وسجل الأحداث والإشعارات وأدوات العرض والصفحتان العموميتان، ويوسع في المرحلة 1 بالمجموعات الباقية (الملف كاملا، والأطراف، والطلبات، والوثائق، والمسطرة، والمال، والتنفيذ، والقواعد، والتوقيع).

## قواعد عامة

- قاعدة المعطيات PostgreSQL. المخطط في `apps/web/prisma/schema.prisma`، والهجرات مؤرخة في `apps/web/prisma/migrations/`، وتطبق بـ`prisma migrate deploy` وحده.
- دوران: الدور المالك (للهجرات وإسناد الصلاحيات والتهيئة وحدها)، ودور التطبيق `mahkama_app` الذي يشتغل به التطبيق والـworker. دور التطبيق لا يملك جدولا، ولا يحق له إنشاء شيء في المخطط، وليس له على جدول الأحداث غير القراءة والإضافة.
- كل تاريخ قانوني أو معروض يؤخذ من ساعة المنصة. ومؤقتات الأمان (الجلسات، والقفل، وصلاحية الرموز، وحدود الطلبات) تؤخذ من الزمن الحقيقي. ويذكر أمام كل عمود زمني مصدره.
- لا تحفظ كلمة سر ولا رمز ولا رمز تفعيل بنصه: تحفظ بصمته وحدها. ولا يحفظ عنوان العميل بنصه: تحفظ بصمته المفتاحية.
- الأسماء والمحاكم في بيئة العرض مفترضة كلها. والصفوف التي تهيئها بيانات العرض موسومة (`isDemo`).

## الأشخاص والصفات

| الجدول | الغاية | الأعمدة الأساسية | من يكتبه |
| --- | --- | --- | --- |
| `Court` | المحكمة ودرجتها | `code` (فريد)، `name`، `degree` (`FIRST_INSTANCE` ابتدائية، `APPEAL` استئناف)، `appealCourtId` (محكمة الاستئناف التي تتبعها) | التهيئة، ثم مدبر النظام في مرحلة لاحقة |
| `Panel` | الهيئة داخل المحكمة | `courtId`، `name`، `kind` (`COLLEGIAL` جماعية، `SINGLE` فردية) | التهيئة |
| `Organization` | الجهة التي ينتمي إليها الحساب | `kind` (`LAW_FIRM` مكتب محاماة، `BANK` بنك، `PUBLIC_ADMINISTRATION` إدارة عمومية، `STATE_JUDICIAL_AGENCY` الوكالة القضائية للمملكة، `EXPERT_OFFICE`، `BAILIFF_OFFICE`)، `name` | التهيئة، ومدبر النظام عند إنشاء حساب |
| `User` | صاحب الحساب | `email` (فريد، بحروف صغيرة)، `fullName`، `phone`، `passwordHash` (Argon2id، فارغ قبل التفعيل)، `isDemo`، `disabledAt`، `lastLoginAt` (زمن المنصة: يقارن به «جديد منذ آخر دخول»)، `createdByUserId`، `createdInSessionId` (جلسة المدبر التي أنشأت الحساب، وهي وحدها ترى روابط تفعيله في صندوق الرسائل الصادرة) | التهيئة، ومدبر النظام |
| `RoleAssignment` | صفة من صفات المستعمل، ويجوز أن تتعدد | `userId`، `role` (إحدى الصفات الست والعشرين)، `courtId`، `organizationId`، `panelId`، `verificationStatus` (`VERIFIED_SIMULATED` «تم التحقق (محاكاة)»، `VERIFIED`، `UNVERIFIED`)، `verificationSource`، `revokedAt` | التهيئة، ومدبر النظام |

قيد في الخدمة لا في المخطط: صفة مدبر النظام وصفة المختص القانوني المصادق على القواعد لا تجتمعان مع صفة أخرى للمستعمل نفسه.

## الهوية والجلسات والأمان

| الجدول | الغاية | الأعمدة الأساسية | ملاحظات |
| --- | --- | --- | --- |
| `Session` | الجلسة القائمة أو غير المكتملة | `tokenHash` (بصمة SHA-256 للرمز، فريدة)، `userId`، `state` (`PENDING_SECOND_FACTOR`، `PENDING_ROLE`، `ACTIVE`)، `origin` (`LOGIN` أو `DEMO_SWITCH`)، `roleAssignmentId`، `createdAt`، `lastSeenAt`، `absoluteExpiresAt`، `pendingExpiresAt`، `previousLoginAt`، `reauthAt`، `revokedAt`، `revokeReason`، `resendCount`، `clientIdHash` | الأزمنة كلها حقيقية، إلا `previousLoginAt` فهو زمن المنصة لأنه نسخة من `User.lastLoginAt`. الرمز نفسه في ملف التعريف وحده |
| `SecondFactorChallenge` | رمز وسيلة التأكيد الثانية | `sessionId`، `userId`، `codeMac` (بصمة مفتاحية للرمز)، `createdAt`، `expiresAt`، `consumedAt`، `voidedAt` | يستهلك بعملية واحدة ذرية |
| `KnownDevice` | المتصفحات التي أتم فيها صاحب الحساب وسيلة التأكيد الثانية | `userId`، `deviceIdHash`، `createdAt`، `lastSeenAt`، `expiresAt` | به تحسب محاولات المتصفح المعتاد في حساب مستقل |
| `ActivationToken` | رابط تفعيل الحساب | `userId`، `tokenHash` (فريد)، `createdAt`، `expiresAt`، `usedAt`، `voidedAt`، `createdByUserId` | يستعمل مرة واحدة، ويبطل بعد أربع وعشرين ساعة أو بإصدار رابط جديد |
| `AuthAttempt` | محاولات الدخول ووسيلة التأكيد وكلمة العبور وإعادة التحقق والتفعيل | `kind`، `identifierHash` (بصمة البريد، سواء وجد الحساب أم لم يوجد)، `bucket` (`default` أو `device:<معرف>`)، `clientIdHash`، `ok`، `at` | منه تحسب حدود المحاولات |
| `Lockout` | القفل المؤقت | `identifierHash`، `bucket`، `cause`، `createdAt`، `until` | القفل لا يبطل جلسة قائمة، إلا إذا نتج عن فشل إعادة التحقق |
| `RateLimitHit` | حدود الطلبات لكل عميل أو جلسة أو بصفة شاملة | `key`، `at` | ينظفه الـworker |

## سجل الأحداث

| الجدول | الغاية | الأعمدة الأساسية |
| --- | --- | --- |
| `Event` | كل عملية: من قام بها، وبأي صفة، ومتى، وفي أي ملف، وبأي سند | `seq` (تسلسل بلا فجوة، مفتاح أساسي)، `id`، `occurredAt` (ساعة المنصة)، `recordedAt` (زمن حقيقي)، `actorUserId`، `actorRoleAssignmentId`، `actorRole`، `viaDemoSwitch`، `clientIdHash`، `action`، `outcome` (`DONE`، `DENIED`، `FAILED`)، `caseFileId`، `legalBasis`، `details`، `keyVersion`، `prevHash`، `hash` (فريدة) |

ضوابطه في قاعدة المعطيات نفسها:

- قيد يرفض كل تعديل أو حذف لصف (`BEFORE UPDATE OR DELETE`)، وقيد يرفض الإفراغ (`BEFORE TRUNCATE`).
- دور التطبيق ليس له على الجدول غير `SELECT` و`INSERT`، ولا يملكه، فلا يستطيع تعطيل القيد ولا حذف الجدول. ويرفض الإقلاع دورا يملكه أو يحق له تعديله.
- لا مفتاح أجنبي من الجدول ولا إليه، حتى لا يمتد إليه حذف من جدول آخر. والمعرفات محفوظة قيما مجردة.
- كل حدث يحمل بصمة الحدث الذي قبله، محسوبة بمفتاح سري لا يدخل القاعدة. ويثبت رأس السلسلة بعد كل تحقق في `SystemState` وفي السجل التقني خارج القاعدة.
- تفاصيل الحدث مخطط مغلق لكل صنف: معرفات وبصمات وأعداد وقيم معدودة، ولا نص حر ولا معطى شخصي.
- الخط الزمني للملف عرض لهذا الجدول، وليس سجلا ثانيا.

## الإشعارات والرسائل

| الجدول | الغاية | الأعمدة الأساسية |
| --- | --- | --- |
| `Notification` | إشعار داخل الفضاء | `userId`، `kind` (`LEGAL_NOTIFICATION` تبليغ قانوني، `INFORMATION` إخبار، `REMINDER` تذكير)، `templateKey`، `params`، `caseFileId`، `targetPath` (مسار داخلي يمر بدالة التحقق)، `createdAt` (ساعة المنصة)، `readAt` |
| `OutboundMessage` | الرسائل النصية والبريد في بيئة العرض: «صندوق الرسائل الصادرة» | `channel` (`SMS`، `EMAIL`)، `sender`، `recipientUserId`، `recipientAddress`، `templateKey`، `body`، `holdsSecret`، `visibleToSessionId`، `createdAt` (ساعة المنصة)، `expiresAt` |

لا يكتب في `OutboundMessage` غير التنفيذ المحاكى لخدمة الرسائل. ورسائل الحسابات غير الموسومة لا تظهر إلا للجلسة التي طلبتها، وتحذف الرسائل الحاملة لرمز أو رابط بعد انقضاء صلاحيتها.

## الحالة العامة والإعدادات

| الجدول | الغاية | الأعمدة الأساسية | ضوابط |
| --- | --- | --- | --- |
| `SystemState` | صف واحد | `databaseMode` (`demo` أو `production`)، `chainHeadSeq`، `chainHeadHash`، `chainStatus` (`UNVERIFIED`، `OK`، `BROKEN`)، `brokenAtSeq`، `lastVerifiedAt`، `lastFullVerifiedAt` | وسم القاعدة لا يتغير بعد وضعه، ولا يحذف الصف بعده (قيد في القاعدة) |
| `PlatformClock` | صف واحد: تقديم ساعة المنصة في بيئة العرض | `offsetSeconds` | لا يكون سالبا ولا ينقص (قيد في القاعدة)، ويرفض الإقلاع في التشغيل الفعلي قيمة غير الصفر |
| `SecretSetting` | الإعدادات المشفرة (مفاتيح المزودين من المرحلة 8) | `name` (فريد)، `ciphertext`، `iv`، `tag`، `last4`، `keyVersion`، `updatedAt`، `updatedByUserId` | AES-256-GCM بمفتاح مشتق من `SECRETS_MASTER_KEY`، ولا يعرض بعد إدخاله غير الأحرف الأربعة الأخيرة |
| `InstitutionalIdentity` | صف واحد: الهوية المؤسسية | `operatorName`، `headerLines`، `logoFileId`، `updatedAt` | في بيئة العرض يعرض دائما الإطار المحايد «موضع الشعار الرسمي» |
| `Job` | طابور المهام المؤجلة | `type` (من قائمة مغلقة)، `payload`، `runAt` (ساعة المنصة)، `status` (`PENDING`، `RUNNING`، `DONE`، `DEAD`)، `attempts`، `lockedAt`، `lockedBy`، `lastErrorClass` | خمس محاولات على الأكثر، والنوع المجهول أو الحمولة غير الصالحة تنقل المهمة إلى `DEAD` |

## الملفات والجلسات (حد أدنى في المرحلة 0)

| الجدول | الغاية | الأعمدة الأساسية |
| --- | --- | --- |
| `CaseFile` | الملف، بما تحتاجه صفحتا «تتبع الملف» و«جدول الجلسات» | `nationalRef` (المعرف الوطني الموحد، فريد)، `courtId`، `number`، `code`، `year` (رقم الملف بالمحكمة: رقم، فرمز، فسنة، والثلاثة مع المحكمة فريدة)، `status` (الحالات الاثنتا عشرة)، `nextHearingId`، `isDemo`، `createdAt` |
| `Hearing` | الجلسة | `courtId`، `panelId`، `room`، `startsAt` (ساعة المنصة) |

الحالات الاثنتا عشرة كما تسميها الدراسة: `FILED` مودع، `REGISTERED` مقيد (لفظ القانون، القرار 21)، `RAPPORTEUR_ASSIGNED` معين مقرره، `IN_NOTIFICATION` في التبليغ، `IN_PREPARATION` في التجهيز، `IN_EXPERTISE` في الخبرة، `READY` جاهز، `IN_DELIBERATION` في المداولة، `JUDGMENT_ISSUED` صدر الحكم، `UNDER_APPEAL` مطعون فيه، `IN_ENFORCEMENT` في التنفيذ، `CLOSED` منته.

ولا تجيب صفحة «تتبع الملف» إلا بالحالة وتاريخ الجلسة المقبلة، ولا صفحة «جدول الجلسات» إلا بالساعة والقاعة والهيئة وأرقام الملفات، دون اسم طرف ولا وثيقة.

## صلاحيات دور التطبيق

يطبقها أمر `db-roles` بالدور المالك بعد كل هجرة:

- نزع كل صلاحية على المخطط من العموم، ومنح دور التطبيق حق الاستعمال دون حق الإنشاء.
- `SELECT` و`INSERT` و`UPDATE` و`DELETE` على كل جدول إلا جدول الأحداث، و`SELECT` و`INSERT` وحدهما على جدول الأحداث، ونزع `UPDATE` و`DELETE` و`TRUNCATE` عليه صراحة من دور التطبيق ومن العموم.
- لا يملك دور التطبيق أي جدول، فلا يستطيع تعطيل قيد ولا حذف جدول.

## توسعة المرحلة 1

تضاف هذه الجداول في هجرة مؤرخة واحدة لا تكسر النسخة السابقة: جداول جديدة، وأعمدة اختيارية في الجداول القائمة. وكل زمن قانوني فيها من ساعة المنصة. ودور التشغيل يقرأ جداول القواعد ولا يكتبها.

### الملف وأطرافه وطلباته

| الجدول | الغاية | الأعمدة الأساسية |
| --- | --- | --- |
| `CaseFile` (أعمدة مضافة) | الملف كاملا | `kind` (`FIRST_INSTANCE`، `APPEAL`، `ENFORCEMENT`)، `caseType` (رمز نوع القضية)، `subject` (موضوعها)، `panelId`، `rapporteurUserId`، `procedure` (`WRITTEN` كتابية، `ORAL` شفوية)، `parentCaseFileId` (ملف الدرجة الأدنى أو ملف الموضوع للتنفيذ)، `registeredAt`، `registrationStampedAt`، `referredToProsecutionAt`، `readyAt`، `pronouncementDate` |
| `CaseParty` | الطرف | `caseFileId`، `side` (`PLAINTIFF`، `DEFENDANT`، `GUARANTOR`، `APPELLANT`، `RESPONDENT`، `ENFORCEMENT_CREDITOR`، `ENFORCEMENT_DEBTOR`، `GARNISHEE`)، `personKind` (`NATURAL`، `LEGAL`، `PUBLIC`)، `displayName`، `legalForm`، `legalRepresentative`، `idNumber` (البطاقة الوطنية أو السجل التجاري، مفترض في العرض)، `litigantUserId`، `organizationId`، `eServiceAcceptedAt`، `position` (ترتيب العرض) |
| `PartyAddress` | عناوين الطرف ومصدر كل عنوان | `partyId`، `kind` (`DOMICILE`، `REGISTERED_OFFICE`، `ELECTED`، `ELECTRONIC`، `PHONE`)، `value`، `source` (`DECLARED` مصرح به، `COMMERCIAL_REGISTER` السجل التجاري م 613، `NATIONAL_ID_DATABASE` قاعدة البطاقة الوطنية م 86، `PLATFORM` المنصة م 626 و627)، `withinCourtDistrict`، `validFrom`، `supersededAt` |
| `Representation` | نيابة المحامي عن الطرف | `partyId`، `lawyerUserId`، `startedAt`، `endedAt`، `accountServiceConsent` (موافقة المادة 633 وتاريخها) |
| `Claim` | الطلبات مفصلة | `caseFileId`، `partyId` (صاحب الطلب)، `category` (`PRINCIPAL` أصلي، `COUNTER` مقابل، `INCIDENTAL` عارض)، `nature` (`DEBT`، `DAMAGES`، `LEGAL_INTEREST`، `PROVISIONAL_ENFORCEMENT`، `COSTS`، `OTHER`)، `amountCents` (محدد القيمة أو فارغ)، `basis`، `filedAt` |

### الوثائق

| الجدول | الغاية | الأعمدة الأساسية |
| --- | --- | --- |
| `Document` | الوثيقة المخزنة | `caseFileId`، `storageKey` (اسم مولد في الحاوية)، `sha256`، `byteSize`، `mediaType`، `docType` (مقال، مذكرة، مستند، أمر، حكم، محضر، وصل، شهادة تسليم، تقرير خبرة…)، `declaredNature` (`ORIGINAL`، `CERTIFIED_COPY`، `PHOTOCOPY`، م 631)، `channel` (`ELECTRONIC`، `PAPER`)، `paperOriginalLocation`، `depositedByUserId`، `depositedByPartyId`، `depositedAt`، `generated` (ولدته المنصة)، `withdrawnAt` (سحب بعد الجاهزية، م 106)، `visibility` (`CASE` لكل ذي علاقة، `PANEL` لأعضاء الهيئة قبل النطق، `JUDGE` للقاضي وحده) |

لا تحذف وثيقة أبدا، والمسحوبة تبقى ظاهرة في خانتها. والنص المستخرج وفقراته المرقمة تضاف مع الإيداع في المرحلة 2.

### المسطرة

| الجدول | الغاية | الأعمدة الأساسية |
| --- | --- | --- |
| `TimeLimit` | الأجل | `caseFileId`، `ruleCode` (من جدول الآجال)، `ruleVersionId`، `partyId`، `startsAt` (الواقعة المنشئة)، `endsAt` (المحسوب)، `electronic`، `status` (`RUNNING`، `MET`، `ELAPSED`، `CLOSED`)، `effectOnExpiry`، `closedAt`، `computation` (تفصيل الاحتساب) |
| `Envelope` | الطي والتبليغ | `caseFileId`، `partyId`، `purpose` (استدعاء، تبليغ حكم، تنفيذ…)، `channel` (`ELECTRONIC`، `BAILIFF`، `CLERK`، `ADMINISTRATIVE`، `REGISTERED_MAIL`، م 83)، `agentUserId`، `status` (`READY`، `DISPATCHED`، `IN_PROGRESS`، `SERVED`، `REFUSED`، `FAILED_UNKNOWN`، `FAILED_MOVED`)، `dispatchedAt`، `servedAt` (تاريخ التوصل الثابت)، `deemedServedAt` (اليوم العاشر بعد الرفض، م 85)، `documentId` |
| `DeliveryCertificate` | شهادة التسليم ببيانات المادة 85 | `envelopeId`، `recipientName`، `recipientIdNumber`، `recipientCapacity` (من قائمة المادة 84)، `occurredAt` (وقت الإنجاز لا وقت الإرسال)، `signature` (`SIGNED`، `UNABLE`، `REFUSED`)، `outcome`، `recordedByUserId`، `source` (`FIELD_APP`، `PAPER`) |
| `ReceiptNotice` | الإشعار بالتوصل في التبليغ الإلكتروني | `envelopeId`، `issuedAt` (م 629) |
| `Hearing` (أعمدة مضافة) | الجلسة | `kind` (`ORDINARY`، `PRONOUNCEMENT`)، `heldAt` |
| `HearingListing` | إدراج الملف في جلسة ونتيجته | `hearingId`، `caseFileId`، `outcome` (`ADJOURNED`، `RETURNED_TO_RAPPORTEUR`، `RESERVED`، `REOPENED`، `PRONOUNCED`)، `outcomeReason`، `minutesDocumentId` |
| `Decision` | الأمر والمقرر والحكم | `caseFileId`، `kind` (`ORDER`، `GRACIOUS_ORDER`، `PRELIMINARY_JUDGMENT`، `JUDGMENT`، `APPELLATE_DECISION`، `EXECUTORY_COPY`)، `subjectCode`، `documentId`، `signatureCircleId`، `pronouncedAt`، `provisionalEnforcement`، `final` |
| `Investigation` | إجراء التحقيق ومهمة الخبير | `caseFileId`، `kind` (`EXPERTISE`، …)، `orderDecisionId`، `expertUserId`، `mission`، `depositAmountCents`، `depositPartyId`، `depositedAt`، `acceptedAt`، `declinedAt`، `partiesSummonedAt`، `reportDocumentId`، `reportDepositedAt`، `returnedAt`، `feesOrderedCents`، `feesPaidAt` |
| `Appeal` | الطعن وصلته بملف الدرجة الأعلى | `lowerCaseFileId`، `upperCaseFileId`، `kind` (`APPEAL`، `CASSATION`)، `appellantPartyId`، `filedAt` |

### المال

| الجدول | الغاية | الأعمدة الأساسية |
| --- | --- | --- |
| `FeeAssessment` | الرسم المحتسب وتفصيله | `caseFileId`، `claimIds`، `ruleVersionId`، `totalCents`، `breakdown` (أسطر الاحتساب وسند كل سطر)، `assessedAt` |
| `Payment` | الأداء | `caseFileId`، `purpose` (`COURT_FEE`، `INVESTIGATION_DEPOSIT`، `COPY_FEE`، `ENFORCEMENT`)، `amountCents`، `payerUserId`، `payerPartyId`، `status` (`SUCCEEDED`، `FAILED`، `CANCELLED`)، `operationRef`، `receiptDocumentId`، `paidAt` (م 628) |
| `TreasuryEntry` | قيود صندوق المحكمة | `caseFileId`، `paymentId`، `direction` (`IN`، `OUT`)، `amountCents`، `purpose`، `beneficiary`، `authorizedByDecisionId` (إذن القاضي، م 120)، `at` |

### التنفيذ

| الجدول | الغاية | الأعمدة الأساسية |
| --- | --- | --- |
| `EnforcementStep` | محاضر التنفيذ وتصريحاته | `caseFileId` (ملف التنفيذ)، `kind` (`DEMAND` تبليغ وإعذار م 486، `COLLECTION` قبض م 487، `EXECUTORY_SEIZURE` م 489، `GARNISHMENT` م 575 و576، `GARNISHMENT_NOTICE` م 578، `GARNISHEE_DECLARATION` م 579، `DISPUTE` م 580، `DIFFICULTY` م 491 و492، `SETTLEMENT` م 488، `RELEASE` رفع الحجز)، `outcome`، `amountCents`، `organizationId` (المحجوز لديه)، `documentId`، `occurredAt` |

### القواعد

| الجدول | الغاية | الأعمدة الأساسية |
| --- | --- | --- |
| `RuleSet` | نسخة مؤرخة من جدول قواعد | `kind` (`TIME_LIMITS`، `FEES`، `HOLIDAYS`، `INTEREST`، `DISTRIBUTION`، `ACCOUNT_BASIS`)، `version`، `validFrom`، `validTo`، `contentSha256`، `content` (القواعد نفسها بسند كل قاعدة)، `loadedAt`، `loadedBy` |
| `RuleChange` | سجل تعديل القواعد بالتوقيع المزدوج (يستعمل من المرحلة 9) | `ruleSetId`، `enteredByUserId`، `validatedByUserId`، `enteredAt`، `validatedAt` |

القاعدة السارية على إجراء هي التي يقع تاريخه بين `validFrom` و`validTo`. وكل قاعدة لا يحسمها نص تحمل علامة `uncertain`، فتظهر بجانبها «قيمة مؤقتة غير مؤكدة».

وتقيد قاعدة المعطيات `kind` بالأنواع المحملة (أنواع المرحلة 1 و`CASE_TYPES` و`DISTRICTS` و`REFERRALS` و`JURISDICTION`، ويضاف كل نوع لاحق بهجرة)، والتاريخين بصيغة YYYY-MM-DD مع `validTo` بعد `validFrom`، وتمنع تداخل إصدارين من نوع واحد (الهجرة `20261125150000_rules_constraints`، الملاحظة P1-A-18).

### التوقيع

| الجدول | الغاية | الأعمدة الأساسية |
| --- | --- | --- |
| `SigningCredential` | الرمز السري للتوقيع | `userId` (فريد)، `secretHash` (Argon2id)، `setAt` |
| `SignatureCircle` | دائرة التوقيع على وثيقة | `documentId`، `purpose`، `signers` (الترتيب: الصفة والمستعمل)، `status` (`OPEN`، `COMPLETED`، `VOIDED`)، `voidReason`، `openedAt`، `completedAt` |
| `Signature` | التوقيع | `circleId`، `position`، `signerUserId`، `signerRoleAssignmentId`، `signerRole`، `documentSha256` (البصمة لحظة التوقيع)، `signedAt` (ساعة المنصة)، `provider` (`SIMULATED`)، `providerRef` |

وتحسب محاولات الرمز السري في `AuthAttempt` بصنف جديد `SIGNING_SECRET`، والقفل في `Lockout`.

## توسعة المرحلة 2

تضاف في هجرة مؤرخة واحدة لا تكسر النسخة السابقة: جداول جديدة، وأعمدة اختيارية، وقيم جديدة في التعدادات. وكل زمن قانوني فيها من ساعة المنصة.

### مشروع الإيداع

| الجدول | الغاية | الأعمدة الأساسية |
| --- | --- | --- |
| `FilingDraft` | مشروع الإيداع قبل إيداعه | `ownerUserId` و`ownerRoleAssignmentId` (صاحبه وحده يطلع عليه)، `channel` (`ELECTRONIC` إلكتروني، `PAPER` ورقي)، `status` (`DRAFT`، `FILED`)، `courtId` (المحكمة المختارة)، `suggestedCourtId`، `caseType` (رمز من جدول أنواع القضايا)، `procedure`، `card` (بطاقة الدعوى بمخطط النواة: الأطراف، وموجز الموضوع والوقائع والأسباب، والطلبات، والتأشير على الأقسام)، `applicationMode` (`UPLOAD` تحميل، `PASTE` لصق، `SCAN` مسح)، `applicationText` (النص الملصق كما أودع)، `applicationParagraphs` (فقراته المرقمة)، `fixedCopyStatus` (`NONE`، `PENDING`، `READY`، `FAILED`)، `designatedBailiffUserId` (م 87)، `paperDepositor` (اسم المودع على الورق وصفته ورقم بطاقته)، `paperLawyerUserId`، `filedAt`، `caseFileId` (فريد) |
| `FilingDocument` | وثائق المشروع | `draftId`، `kind` (`APPLICATION_ORIGINAL` المقال كما أودع، `APPLICATION_COPY` النسخة الثابتة، `EXHIBIT` مستند، `PAYMENT_RECEIPT` وصل الأداء)، `storageKey` (اسم مولد، فريد)، `sha256`، `byteSize`، `mediaType` (من المحتوى)، `title`، `declaredNature` (م 631)، `pageCount`، `paperOriginalLocation`، `position`، `uploadedAt`، `removedAt` (لا يحذف الصف)، `documentId` (الوثيقة في الملف بعد الإيداع، بالمفتاح نفسه في المخزن) |

### الأداء

| الجدول | الغاية | الأعمدة الأساسية |
| --- | --- | --- |
| `PaymentIntent` | عملية الأداء في البوابة | `draftId`، `purpose` (`COURT_FEE`)، `amountCents` (يحسبه الخادم)، `inputsDigest` (بصمة الطلبات والمحكمة والجدول الساري)، `breakdown`، `ruleSetId`، `method` (`ONLINE` عن بعد، `COUNTER` بالشباك)، `status` (`PENDING`، `SUCCEEDED`، `FAILED`، `CANCELLED`، `EXPIRED`)، `createdByUserId`، `expiresAt`، `completedAt`، `paymentId` (فريد) |
| `Payment` (أعمدة مضافة) | الأداء | `caseFileId` صار اختياريا (يملأ عند التقييد)، `courtId`، `draftId`، `intentId` (فريد)، `method`. و`paidAt` وقت العملية، ناجحة كانت أو فاشلة |
| `TreasuryEntry` (أعمدة مضافة) | قيد الصندوق | `caseFileId` صار اختياريا، `courtId`، `draftId` |
| `FeeAssessment` (أعمدة مضافة) | الرسم المحتسب | `caseFileId` صار اختياريا، `draftId`، `inputsDigest` |

ولا يحذف أداء ولا قيد صندوق، ولا يعدل منهما إلا ربطه بالملف عند التقييد (قادح في قاعدة المعطيات).

### التقييد والإحالة

| الجدول | الغاية | الأعمدة الأساسية |
| --- | --- | --- |
| `CaseSequence` | سجل المحكمة للسنة | `courtId`، `year`، `lastNumber`؛ صف واحد لكل محكمة وسنة يزاد بقفل داخل معاملة الإيداع |
| `CaseFile` (أعمدة مضافة) | الملف المقيد | `filingChannel`، `filingDraftId` (فريد)، `filedByUserId`، `designatedBailiffUserId`، `classificationCorrectedAt`، `referredToCommissionerAt`. وقيد فريد على المحكمة والرقم والسنة؛ وقادح يمنع تعديل الرقم والسنة والمحكمة والمعرف الوطني |
| `CaseReferral` | الإحالة التلقائية | `caseFileId`، `target` (`PROSECUTION`، `ROYAL_COMMISSIONER`)، `ground` (`PRINCIPAL_PARTY` م 18، `COMMUNICATION` م 20، `ADMINISTRATIVE_COURT` م 101)، `article`، `item`، `reasonCode`، `ruleSetId`، `createdAt`. والمراجعة التي لم تجد موجبا تدون حدثا |
| `CaseNote` | ملاحظة مكتب التقييد إلى القاضي | `caseFileId`، `authorUserId`، `authorRole`، `reason` (`FEE_SHORTFALL` رسم ناقص، `CLASSIFICATION`، `PARTIES`، `OTHER`)، `text`، `addressedToUserId`، `createdAt`. لا تعدل ولا تحذف |

### الوثائق والمراجع

| الجدول | الغاية | الأعمدة الأساسية |
| --- | --- | --- |
| `Document` (عمود مضاف) | الوثيقة | `pageCount` (المسح الضوئي، والإيداع الورقي) |
| `DocumentParagraph` | فقرات النسخة الثابتة المولدة من نص ملصق أو من DOCX | `documentId`، `position`، `text` |
| `SimulatedRegistryEntry` | السجل التجاري المحاكى | `registry` (`COMMERCIAL_REGISTER`)، `key` (رقم التقييد)، `data` (الاسم، والشكل القانوني، والمقر الاجتماعي، والفرع، والممثل القانوني، والبريد)؛ يقرؤه دور التشغيل ولا يكتبه |
| `Court` (عمود مضاف) | المحكمة | `specialty` (`GENERAL`، `COMMERCIAL`، `ADMINISTRATIVE`)؛ ومنه تشتق «محكمة إدارية» في صورة الملف |
| `RoleAssignment` (عمودان مضافان) | الصفة | `professionalNumber` (الرقم الوطني للمحامي)، `professionalBody` (هيئته)، م 77 |
| `CaseParty` (أعمدة مضافة) | الطرف | `publicEntityKind` (`STATE`، `LOCAL_AUTHORITY`، `PUBLIC_ESTABLISHMENT`، `OTHER_PUBLIC`، `STATE_JUDICIAL_AGENT`، `LOCAL_AUTHORITIES_AGENT`؛ م 20 و605)، `capacityStatus` (`FULL`، `INCAPABLE`، `ABSENT`؛ م 18)، `agentName` و`agentAddress` (وكيل المدعي، م 77) |
| `PartyAddress` (قيمتان مضافتان) | العنوان | `kind`: `RESIDENCE` محل الإقامة، و`BRANCH` مقر الفرع (م 77) |

### الجداول المرجعية الجديدة في `RuleSet`

`CASE_TYPES` (أنواع القضايا ورموزها المفترضة وتخصص كل نوع وما يوجب منها الإحالة، س21)، و`DISTRICTS` (دوائر النفوذ)، و`REFERRALS` (الإحالات على النيابة العامة والمفوض الملكي)، و`JURISDICTION` (عتبة المادة 35). مؤرخة ومسندة كسائر الجداول، ودور التشغيل يقرؤها ولا يكتبها.
