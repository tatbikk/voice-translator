# المراجعة المعمارية للمرحلة 0

*24 نونبر 2026 · مراجع مستقل لم يكتب الكود*

## 1. نطاق المراجعة

الحالة المراجعة هي الالتزام `7bb537d`، ومعها تعديلات غير ملتزمة في `apps/web/tests/**` كانت جارية أثناء المراجعة. ولم يتغير كود التطبيق بعد `073e5d6` إلا في `apps/web/src/server/secrets/store.ts` (الالتزام `18f49b6`)، وقرئت صيغته الأخيرة. ولم يفتح أي ملف من ملفات البيئة المحلية.

### ما قرئ

- `CLAUDE.md`، و`docs/build-prompt.md` كاملا، و`docs/phases/phase-0.md`، و`docs/phases/phase-0-contract.md`، و`docs/decisions.md`، و`docs/data-model.md`، و`docs/security/phase-0-memo.md`، و`docs/production-readiness.md`.
- `packages/core/src/**` كله، واختبارات النواة.
- `apps/web/src/server/**` كله؛ والصفحات والمسارات البرمجية كلها في `apps/web/src/app/**`؛ و`apps/web/src/components/shell/**` و`components/ui/ActionButton.tsx` و`components/client/api.ts`؛ و`apps/web/src/demo/**`؛ و`apps/web/src/i18n/*.ts`؛ و`apps/web/src/cli/**`؛ و`apps/web/src/worker/main.ts`؛ و`apps/web/src/proxy.ts`؛ و`apps/web/src/instrumentation.ts`.
- `apps/web/prisma/schema.prisma` والهجرة `apps/web/prisma/migrations/20261124121755_foundation/migration.sql`.
- `Dockerfile`، و`.dockerignore`، و`.railway/railway.ts` مقابل أنواع `node_modules/railway/dist/index-CweUhAOc.d.ts`، و`.railway/README.md`، و`.github/workflows/{ci,scheduled,railway-config}.yml`، و`.github/scripts/*.sh`، و`.github/dependabot.yml`، و`apps/web/scripts/{bundle,check-build,e2e-server}.mjs`، و`eslint.config.mjs`، وملفات `tsconfig` و`vitest` و`playwright.config.ts`.
- `apps/web/tests/architecture/**` ومساعداتها، وما يلزم من اختبارات التكامل للتحقق من التغطية، قراءة فقط.

### ما شغل

لا شيء مما يلي يمس قاعدة المعطيات ولا `apps/web/.next`.

| الأمر | النتيجة |
| --- | --- |
| `npx eslint .`، بدل `npm run lint` حتى لا يعاد توليد عميل Prisma أثناء اشتغال وكيل آخر به | التشغيل الأول: تسعة أخطاء، كلها في ملفات اختبار لم تكن ملتزمة بعد. التشغيل الثاني على الحالة المحدثة: لا خطأ، وثمانية تنبيهات كلها في `apps/web/tests/**` |
| `npx tsc -p tsconfig.json --noEmit` في الجذر، وهو يشمل `.railway/railway.ts` | ناجح |
| `npx tsc -p packages/core/tsconfig.json --noEmit` و`npx tsc -p apps/web/tsconfig.json --noEmit` | ناجحان |
| `npm test -w @mahkama/core` | ثمانية ملفات و426 اختبارا، كلها ناجحة |
| `npx vitest run --config vitest.config.ts` من `apps/web` | ملفان و28 اختبارا، كلها ناجحة |
| `npx vitest run --config vitest.arch.config.ts` من `apps/web`، وهي فحوص ساكنة على شجرة المصادر | 81 اختبارا، فشل منها واحد: «the (gate) and (app) layouts render the demo slot» |

### ما لم يشغل

التزاما بشروط المراجعة لم تشغل اختبارات التكامل ولا اختبارات المسار، ولا البناء، ولا صورة Docker، ولا أوامر التهيئة و`db-roles` والهجرات، ولا `npm audit` ولا Semgrep ولا gitleaks. ورجع المراجع إلى وثائق Railway العامة في أمرين لا غير: قيود المتغيرات المختومة، ومدة التصريف بين SIGTERM وSIGKILL.

### حدود المراجعة

هي مراجعة داخلية بقراءة الكود، لا تقوم مقام تدقيق أمني مستقل ولا اختبار اختراق. وكل ما وصف أدناه بأنه «غير متيقن» لم يتحقق منه بالتشغيل.

## 2. الملاحظات

ملخص الدرجات: ثلاث مرتفعة (A-01 إلى A-03)، وسبع متوسطة (A-04 إلى A-10)، وثمان منخفضة (A-11 إلى A-18). ولا ملاحظة حرجة.

### A-01. بيانات اعتماد الدور المالك لقاعدة المعطيات في بيئة عملية الويب أثناء التشغيل

- الدرجة: مرتفعة.
- الموضع: `.railway/railway.ts:39` (`MIGRATION_DATABASE_URL: db.env.DATABASE_URL`) و`.railway/railway.ts:45` (`SEED_DEMO_PASSWORD`) ضمن متغيرات خدمة `web`، مع `.railway/railway.ts:26` (`preDeploy`) و`.railway/railway.ts:28` (`start`)؛ ويقابلها في CI `.github/workflows/ci.yml:124-126`. والقاعدة المخروقة: العقد §3، سطر `MIGRATION_DATABASE_URL` («Never given to the web process at runtime except in preDeploy»)، والقرار 8 في `docs/decisions.md`.
- الوصف: متغيرات الخدمة في Railway تسري على خطوة ما قبل النشر وعلى العملية المشتغلة معا، ولا يمكن قصرها على إحداهما. فعملية `next start` تحمل في بيئتها رابط الدور المالك لجدول `"Event"`، وتحمل في الوقت نفسه `SECRETS_MASTER_KEY` الذي يشتق منه مفتاح السلسلة. ومن نفذ كودا في عملية الويب، بثغرة في اعتمادية مثلا، يستطيع بذلك تعطيل القوادح، وتعديل أحداث سابقة أو حذفها، وإعادة حساب البصمات بالمفتاح، فلا يكشفه `events:verify`. وهذا ما بني القرار 8 والحالة 15 من المذكرة لمنعه: دور التشغيل لا يملك الجدول حتى لا تكفي السيطرة على التطبيق لإعادة كتابة السجل. ويقرأ من العملية نفسها `SEED_DEMO_PASSWORD`، وهو كلمة سر كل حسابات العرض.
- الإصلاح:
  1. فصل الدور المالك عن العملية المشتغلة: إما خدمة إصدار مستقلة من الصورة نفسها تحمل وحدها `MIGRATION_DATABASE_URL` و`SEED_DEMO_PASSWORD` وتنفذ `node dist-server/release.mjs`، وإما، في أدنى الأحوال، أمر إقلاع ينزع المتغيرين قبل التطبيق: `env -u MIGRATION_DATABASE_URL -u SEED_DEMO_PASSWORD node ../../node_modules/next/dist/bin/next start`. وفي الحل الثاني يبقى غير متيقن هل تظل القيمتان مقروءتين من بيئة العملية الأصل في الحاوية، فيتحقق من ذلك على النسخة المنشورة.
  2. إضافة مخالفة إقلاع في `evaluateBoot` (`packages/core/src/boot.ts`) ترفض إقلاع `web` و`worker` إذا كان `MIGRATION_DATABASE_URL` أو `SEED_DEMO_PASSWORD` حاضرا في البيئة، حتى لا يعود الخلل.
  3. اختبار تكامل لهذه المخالفة، وتعديل مهمة `image` في CI لتمرير البيئة إلى حاوية الويب دون المتغيرين.

### A-02. اختبارا العقد للمكونين المؤقتين موجودان ولا يشغلهما أي اختبار

- الدرجة: مرتفعة.
- الموضع: `apps/web/src/server/messaging/contract.ts:16` (`MESSAGING_CONTRACT`) و`apps/web/src/server/identity/contract.ts:9` (`IDENTITY_CONTRACT`). ولا يستوردهما أي ملف في `apps/web/tests` ولا في `apps/web/src`: البحث عن الاسمين لا يعيد غير تعريفهما. والقاعدة: `CLAUDE.md`، باب «قواعد لا تخرق» («كل مكون يتوقف على جهة خارجية يوضع خلف واجهة داخلية لها اختبار عقد»)؛ والبرومبت، باب «المكونات المؤقتة وكيف تستبدل»، الشرط الثالث؛ والخطة، فقرة «الاختبارات» («واختبارا العقد»). ويقرر `docs/production-readiness.md:13-14` أن اختبار العقد «يجتازه التنفيذان»، وهو لم يشغل.
- الوصف: الواجهتان `MessagingProvider` و`ProfessionalIdentityProvider` قائمتان، والتنفيذان المحاكيان خلفهما. لكن شرط الإحلال المحصور، أي أن يجتاز التنفيذ الحقيقي غدا اختبارا يجتازه المحاكى اليوم، غير محقق. والمجموعتان رقيقتان كذلك: عقد الرسائل لا يتحقق إلا من أن `send` لا يرمي خطأ، ولا يتحقق من أن رسالة `holdsSecret` تحمل `expiresAt`، ولا من حصر رؤيتها بالجلسة؛ وعقد الهوية يجرب ثلاث صفات فقط. ويقول التعليق في `apps/web/src/server/messaging/index.ts:5-13` إن التنفيذ يختار «بالإعداد»، ولا متغير يختار بين تنفيذين، لا هنا ولا في `apps/web/src/server/identity/index.ts`. وهذا مقبول ما دام التنفيذ واحدا، ويلزم قبل إضافة الثاني.
- الإصلاح: ملف اختبار، مثل `apps/web/tests/integration/contracts.test.ts`، يمر على كل عنصر من المجموعتين مع `messaging()` و`professionalIdentity()`، ومع تنفيذ اختبار ثان يثبت أن المجموعة لا تتوقف على التنفيذ. وتقوية العقد بالشروط المذكورة. وتصحيح عبارة `docs/production-readiness.md` إلى أن يتحقق ذلك.

### A-03. سلسلة CI لا تنجح في حالتها الراهنة، فلا نشر

- الدرجة: مرتفعة.
- الموضع:
  1. `.github/workflows/ci.yml:43-67`: مهمة `integration` تنفذ `npm ci` ثم `npm run test:int` دون `prisma generate`. والعميل المولد مستبعد من المستودع (`.gitignore:4`)، و`@prisma/client@7.10.1` لا يحمل أمر `postinstall` يولده. فيفشل `bundleServer()` في `apps/web/tests/helpers/global-setup.ts:13`، لأن esbuild لا يجد `@/generated/prisma/client` الذي يستورده `apps/web/src/server/db.ts`، وتفشل اختبارات التكامل كلها قبل أن تبدأ.
  2. `npm run check` يشغل `test:arch`، وفيه فشل قائم في `apps/web/tests/architecture/pages.test.ts:158`: الاختبار يطلب `src/app/(gate)/layout.tsx` و`src/app/(app)/layout.tsx`، وهما غير موجودين. والعقد §2 (القاعدة 7) و§9 يجعلان موضع `demo-slot.tsx` في هذين التخطيطين، أما الكود فيعرضه من `Frame` في كل صفحة (`apps/web/src/components/shell/Frames.tsx:21`).
  3. `.railway/railway.ts:14` ينتظر نجاح الفحوص (`checkSuites: true`)، فلا نشر ما دام CI أحمر.
- الوصف: الفحوص الآلية عند كل دفع شرط من شروط المرحلة، وهي بوابة النشر. وفي الحالة الراهنة تفشل مهمة `check` باختبار المعمار، وتفشل مهمة `integration` بغياب التوليد، فلا يثبت في CI شيء من البنود 1 و3 و5 و6 من تعريف الإنجاز (العقد §13). وفي الترتيب: التزمت اختبارات الرفض في `7bb537d`، ورسالته «in progress»، بعد الكود الذي تحرسه في `073e5d6`. فلا يشهد سجل git على قاعدة «اختبارات الرفض تكتب قبل الكود الذي تحرسه»، وإن دلت أزمنة الملفات على أنها كتبت معه. وكانت الاختبارات تعدل أثناء المراجعة، فلم يتحقق المراجع من مهمة `e2e`.
- الإصلاح: خطوة `npm run generate` في مهمة `integration` قبل `npm run test:int`، أو أمر `postinstall` في `apps/web/package.json` ينفذ `prisma generate`. وحسم مسألة التخطيطين: إما إنشاء `(gate)/layout.tsx` و`(app)/layout.tsx` يعرضان `DemoSlot` ويبدآن بحارس، وإما قرار مدون في `docs/decisions.md` يجعل الموضع `Frame`، ويعدل العقد والاختبار وفقه. ثم تشغيل CI كاملا قبل عرض المرحلة للقبول.

### A-04. قرارات ولوج متفرقة خارج دالة النواة، و`availableActions` غير مستعملة

- الدرجة: متوسطة.
- الموضع:
  - `apps/web/src/server/dashboard/service.ts:23`: `if (subject.role === 'SYSTEM_ADMIN')` يقرر من يرى حالة سلسلة السجل.
  - `apps/web/src/app/(app)/admin/accounts/page.tsx:76`: الشرط `!a.activated && !a.disabled` يقرر ظهور زر «إعادة إرسال رابط التفعيل». والشرط `TARGET_NOT_ACTIVATED` في `packages/core/src/conditions.ts:40-43` لا يعرف التعطيل، والمورد `account` في `packages/core/src/subject.ts:26` لا يحمله. فيقبل الخادم إعادة الإرسال لحساب معطل والشاشة تخفي زرها.
  - `apps/web/src/app/(gate)/environment/page.tsx:13`: `if (context.mode !== 'demo') notFound()`، فوجود الصفحة مقرر خارج جدول الإجراءات.
  - `apps/web/src/components/shell/demo-slot.tsx:12` و`apps/web/src/demo/ui/DemoBar.tsx:14`: يعرض شريط أدوات العرض وتستدعى `demoAccounts()` بشرط `context.demoToolsEnabled` وحده، دون `authorize(subject, 'demo.accounts.list')` الذي يحرس به المسار `/api/demo/accounts` المعطى نفسه.
  - `availableActions` (`packages/core/src/authorize.ts:74-83`) لا تستدعى في أي موضع من `apps/web`، وخانة «ينتظر إجراء مني» مثبتة فارغة في `apps/web/src/server/dashboard/service.ts:28`، والعقد §7 يجعلها محسوبة منها.
- الوصف: البرومبت يجعل التحقق يمر «عبر دالة واحدة في النواة، هي التي تحسب «الإجراءات المتاحة»، لا عبر شروط متفرقة في الشاشات»، ويجعل الزر سلطة قانونية تحسب من الجدول. ولا تفتح هذه المواضع اليوم منفذا، لأن الخادم يعيد التحقق في المسار البرمجي. لكنها النمط الذي ستنسخه المرحلة 1 في أزرار المسطرة، وقد أنتجت أول تباعد بين الشاشة والنواة، وهو حالة الحساب المعطل. ويذكر للعلم أن صنفي الولوج `pending-session` و`session` يقرران خارج النواة كذلك (`apps/web/src/server/http/endpoint.ts:191-197` و`apps/web/src/server/permissions/guard.ts:68-92`)، وهذا مطابق للعقد §6 ومقبول لأنه لا يتعلق بصفة.
- الإصلاح: إضافة إجراءين إلى `ACTIONS`: `events.chain-status.view` لـ`SYSTEM_ADMIN`، و`environment.view` بشرط وضع العرض. وإضافة `disabled` إلى المورد `account`، وشرط `TARGET_NOT_DISABLED` إلى `admin.accounts.reissue-activation`، وحساب زر إعادة الإرسال من `availableActions(subject, resource, context)`. وأن يستدعي `DemoSlot` الدالة `authorize` على `demo.accounts.list` و`demo.outbox.view` قبل العرض. وبناء خانة «ينتظر إجراء مني» من `availableActions`. واختبار معمار يمنع مقارنة الصفة (`role ===`) خارج `packages/core`.

### A-05. رفض لا يدون، وأسباب في فهرس الأحداث لا تصدر

- الدرجة: متوسطة.
- الموضع: `apps/web/src/server/auth/login.ts:240-241` (`verifySecondFactor`) و`apps/web/src/server/auth/login.ts:387-388` (`reauthenticate`) يعيدان «مقفل» دون أي حدث؛ والسبب `LOCKED` في `auth.second-factor.refused` (`packages/core/src/events.ts:49`) معرف ولا يصدر أبدا. وأسباب `auth.session.revoked` في `packages/core/src/events.ts:62-75`، أي `NEW_LOGIN` و`DEMO_SWITCH` و`REAUTH_LOCK` و`SECOND_FACTOR_LOCK` و`LOGOUT`، لا تصدر، مع أن الإبطال يقع فعلا في `apps/web/src/server/auth/login.ts:200` و`:267` و`:398` و`apps/web/src/demo/server/services.ts:87`. وتدون الجلسة المنتهية بالسبب `'LOGOUT'` في `apps/web/src/server/auth/sessions.ts:139`.
- الوصف: البرومبت يوجب «وكل رفض يدون»، وشرط القبول 3 يطلب تدوين كل رفض. ومحاولة رمز التأكيد أو إعادة التحقق أثناء قفل قائم ترفض دون أثر في السجل، وهي لا تحسب في المحاولات كذلك، فلا يبقى لها أثر في أي موضع. ولا تفتح هذه الحالة منفذا، لكنها ثغرة في الأثر تمس شرطا من شروط القبول. والأسباب المعلنة في الفهرس المغلق وغير الصادرة تجعله يعد بما لا يقع، ويحمل `revokeReason` للجلسة المنتهية قيمة غير صحيحة.
- الإصلاح: إصدار `auth.second-factor.refused` بالسبب `LOCKED`، وحدث لإعادة التحقق أثناء القفل (سبب في `auth.reauth.failed` أو صنف `auth.reauth.blocked`)، يمران كلاهما بحد الرفض. وإصدار `auth.session.revoked` بسببه الفعلي في كل إبطال، داخل المعاملة نفسها وفي آخرها. وسبب مستقل للانتهاء بدل `'LOGOUT'`. واختبارات لكل ذلك في `apps/web/tests/integration/events-coverage.test.ts`.

### A-06. الحدود والعدادات تقرأ ثم تكتب دون تسلسل

- الدرجة: متوسطة.
- الموضع: `apps/web/src/server/security/rate-limit.ts:14-18` (`consume`: عد ثم إدراج)؛ `apps/web/src/server/auth/login.ts:254-273` (الرمز الخاطئ: فحص القفل ثم المقارنة ثم تسجيل المحاولة ثم العد ثم القفل، بلا معاملة ولا قفل)، و`apps/web/src/server/auth/login.ts:165-176` (كلمة السر)؛ `apps/web/src/server/auth/access-gate.ts:72-87`.
- الوصف: طلبات متوازية على حساب واحد تمر كلها بفحص `activeLock` قبل أن يكتب أولها القفل، فيقيم الخادم قبل القفل أكثر من الرموز الخمسة التي تحددها السياسة. وهذا يضعف الضابط الأول في المذكرة، أي منع تخمين رمز التأكيد، بقدر التوازي الذي يسمح به مجمع الاتصالات (`max: 10` في `apps/web/src/server/db.ts:18`)، ويجعل حدود الطلبات كلها تقريبية. ولا اختبار تزامن يغطي ذلك.
- الإصلاح: معاملة واحدة لكل محاولة، تبدأ بـ`pg_advisory_xact_lock` على بصمة المعرف (مثل `hashtextextended(identifierHash, 0)`)، ثم فحص القفل، ثم المقارنة، ثم تسجيل المحاولة، ثم العد، ثم القفل؛ أو عداد ذري في صف واحد (`INSERT … ON CONFLICT DO UPDATE … RETURNING`). والأسلوب الذري نفسه في `consume`. واختبار تكامل: عشرون رمزا خاطئا متوازيا لا يقيم منها أكثر من خمسة.

### A-07. كل رفض بلا جلسة يكتب في السجل تحت قفل واحد، بلا سقف شامل

- الدرجة: متوسطة.
- الموضع: `apps/web/src/server/events/append.ts:30` و`:58` (قفل استشاري واحد لكل كتابة في السجل)؛ `apps/web/src/server/security/refusals.ts:37-55` (لكل رفض: عد وإدراج في `RateLimitHit` ثم `appendStandaloneEvent`)؛ `packages/core/src/security-policy.ts:34-35` (حد لكل عميل ولكل جلسة فقط)؛ `apps/web/src/server/auth/client-id.ts:34` (تجميع IPv6 على /64).
- الوصف: القرار 3 يحد الإغراق لكل عميل، ولا سقف شاملا لما يدون فرديا من رفض الطلبات التي لا جلسة لها، خلافا لكلمة عبور الزوار التي لها حد شامل. ومن يملك عناوين كثيرة، كشبكة أجهزة أو نطاق IPv6 من /56 أو /48 فيه مئات أو آلاف من نطاقات /64، يكتب ثلاثين حدثا في الدقيقة لكل عنوان، وكل حدث يأخذ القفل الذي تنتظره كل عملية مشروعة، في جدول لا يمحى منه شيء. فالأثر على توافر المنصة وعلى حجم القاعدة.
- الإصلاح: سقف شامل في الدقيقة للرفض المدون فرديا، على منوال `accessCode.global`، لا يدون بعده إلا العدد في حدث جامع. وتجميع IPv6 على /56 أو /48 في حد الرفض. وقياس معدل الكتابة في السجل ضمن اختبار التحمل المدرج في لائحة الجاهزية. وتدوين القرار.

### A-08. التحقق من السلسلة يحمل السجل كله في الذاكرة

- الدرجة: متوسطة.
- الموضع: `apps/web/src/server/events/verify.ts:53-57` (`collect`) و`:75` و`:78`؛ `packages/core/src/event-chain.ts:100-104` (`verifyChain` تأخذ `Iterable` متزامنا).
- الوصف: الدالة `rowsFrom` تقرأ بالصفحات، لكن `collect` تجمع الصفوف كلها قبل التحقق. والتحقق الكامل يجري مرة في اليوم من أول السجل، وعند كل تنفيذ لـ`events:verify`. والسجل يكبر بلا حد: كل رفض، وكل دخول، وحدث `events.chain.verified` كل عشر دقائق. فتكبر ذاكرة الـworker معه حتى يتوقف، ويتوقف معه التحقق، وهو الضابط نفسه.
- الإصلاح: تحقق متدفق: محقق ذو حالة في النواة (مثل `createChainVerifier(keyring, anchor)` بدالتي `push(row)` و`result()`) يحفظ `expectedSeq` و`expectedPrev` بين الصفحات، والتحقق من المرساة أثناء المرور بدل `rows.find`. واختبار بآلاف الصفوف يثبت أن الذاكرة لا تتبع حجم السجل.

### A-09. الخروج يمحو ملف تعريف الجهاز، فيسقط ضابط القرار 11

- الدرجة: متوسطة.
- الموضع: `apps/web/src/app/api/v1/auth/logout/route.ts:14` (`Clear-Site-Data: "cookies", "storage"`)؛ والعقد §6 الذي يفرض هذا الرأس، و§4.5 الذي يفرض ملف الجهاز؛ والقرار 11. ويقر بالأثر مساعد الاختبار `apps/web/tests/helpers/http.ts:396-397` («removes every cookie of the origin»).
- الوصف: هذا الرأس يمحو كل ملفات التعريف للموقع، ومنها `__Host-mr-device`. فالمستعمل الذي يخرج، وهو ما يطلب منه، يفقد ملف جهازه، ويعود دخوله التالي إلى الدلو العام الذي يستطيع المهاجم قفله. فلا ينفع ملف الجهاز إلا من لا يخرج أبدا، ويعود القفل أداة لمنع قاض أو محام من إجراء في آخر يوم من أجل، وهو ما بني القرار 11 لمنعه. ويمحو الرأس كذلك `__Host-mr-access` وتفضيلات اللغة والقراءة. والتعارض قائم في العقد نفسه.
- الإصلاح: الاكتفاء عند الخروج بإنهاء ملفي الجلسة والحماية (`Max-Age=0`) مع `Clear-Site-Data: "storage"` أو `"cache"`، وإبقاء ملف الجهاز؛ أو قرار مدون يقبل المقايضة صراحة. واختبار يثبت أن دخول المتصفح نفسه بعد الخروج يبقى في دلو الجهاز.

### A-10. خلط مرجعي الزمن في الأعمدة نفسها

- الدرجة: متوسطة.
- الموضع: `OutboundMessage.expiresAt` يكتب بالزمن الحقيقي لرموز التأكيد (`apps/web/src/server/auth/login.ts:115` ثم `:97`)، وبزمن المنصة لروابط التفعيل (`apps/web/src/server/accounts/service.ts:184` و`:230`)، ويقارن بزمن المنصة عند التنظيف (`apps/web/src/server/security/maintenance.ts:23`). و`User.lastLoginAt` يكتب بزمن المنصة (`apps/web/src/server/auth/login.ts:292`)، ومنه يؤخذ `Session.previousLoginAt`، بينما يقول `docs/data-model.md:20` و`:29` إنهما زمن حقيقي. وحدث `system.boot` يكتب قبل أي `clock.refresh()` (`apps/web/src/server/boot/check.ts:91`)، فيحمل `occurredAt` دون تقديم الساعة.
- الوصف: متى قدمت ساعة المنصة في بيئة العرض، وأداتها في المرحلة 1، صار كل رمز تأكيد «منتهيا» عند أول تنظيف، فيحذف من «صندوق الرسائل الصادرة» خلال الدقائق العشر التالية وإن بقي صالحا، فيتعذر الدخول أو لا يتعذر بحسب توقيت التنظيف. ومدة رابط التفعيل مكررة بقيمة صريحة (`24 * 60 * 60 * 1000`) بدل `SECURITY_POLICY.activation.ttlMs`، وبمرجع زمني غير مرجع الرمز نفسه.
- الإصلاح: تحديد مرجع كل عمود زمني في `docs/data-model.md`، كما تقرره الوثيقة نفسها («ويذكر أمام كل عمود زمني مصدره»). وكتابة `expiresAt` بمرجع صلاحية السر نفسه (`systemNow`) والمقارنة به عند التنظيف. واستعمال ثوابت السياسة. وتصحيح الوثيقة في `lastLoginAt` و`previousLoginAt`. واستدعاء `clock.refresh()` في `enforceBoot` قبل الحدث. ويلزم الإصلاح قبل بناء أداة تقديم الساعة.

### A-11. جدولة الـworker وإيقافه

- الدرجة: منخفضة.
- الموضع: `apps/web/src/worker/main.ts:21-35` و`:56-65`؛ `.railway/railway.ts:57-58`؛ `apps/web/src/server/jobs/queue.ts:51-60`.
- الوصف: المهام كلها على سلسلة وعود واحدة دون منع لتراكب المهمة الواحدة، فتتراكم النبضات خلف مهمة بطيئة، كالتحقق الكامل، ثم تنفذ متتابعة. و`stopping` يفحص عند جدولة النبضة لا عند تنفيذها (`apps/web/src/worker/main.ts:23`)، فتنفذ بعد SIGTERM النبضات المنتظرة كلها. ومدة التصريف في Railway صفر ثانية افتراضا بحسب ما يذكره دعم Railway، ولم يضبط `drainingSeconds`، وهو متاح في `DeployConfig`، فيتبع SIGKILL الإشارة فورا. والمهمة التي تبقى `RUNNING` بعد توقف مفاجئ لا تسترجع أبدا، إذ لا شيء يعيد المهام ذات `lockedAt` القديم. ولا مهمة تدرج في الطابور في المرحلة 0، فالأثر اليوم محدود.
- الإصلاح: علم «قيد التنفيذ» لكل مهمة يتخطى النبضة إن لم تنته سابقتها؛ وفحص `stopping` داخل الدالة المتسلسلة؛ و`deploy: { drainingSeconds: 30 }` للـworker وللويب؛ واسترجاع المهام `RUNNING` التي تجاوز `lockedAt` فيها مدة معلومة.

### A-12. ترتيب التنظيف يصطدم بالمفتاح الأجنبي

- الدرجة: منخفضة.
- الموضع: `apps/web/src/server/security/maintenance.ts:15-16`؛ `apps/web/prisma/migrations/20261124121755_foundation/migration.sql:461` (`SecondFactorChallenge_sessionId_fkey … ON DELETE RESTRICT`).
- الوصف: تحذف الجلسات الملغاة منذ يوم، ولا تحذف رموزها المستهلكة إلا إذا انقضت صلاحيتها منذ يوم. فالجلسة التي ألغيت قبل انقضاء صلاحية رمزها، بخروج أو بتبديل حساب في الدقائق الخمس الأولى، وهذا كثير في العرض، تجعل `session.deleteMany` يفشل في نافذة من بضع دقائق، فيتوقف التنظيف كله في تلك الدورة، ومنه حذف الرسائل الحاملة للرموز.
- الإصلاح: حذف رموز الجلسات المستهدفة أولا (`where: { session: { OR: [...] } }`)، أو `onDelete: Cascade` على هذا المفتاح، أو فصل كل حذف عن غيره في معالجة الخطأ.

### A-13. الحدث الجامع للرفض المحجوب يكتب ثم يحذف أصله خارج معاملة واحدة

- الدرجة: منخفضة.
- الموضع: `apps/web/src/server/security/refusals.ts:64-85`، والإلحاق في `:76` والحذف في `:81`.
- الوصف: توقف العملية بين الإلحاق والحذف، أو اشتغال نسختين من الـworker، يكتب حدث `access.throttled` مرتين للنافذة نفسها في سجل لا يمحى. وإصابة تسجل على حد الدقيقة بعد التفريغ تنتج حدثا ثانيا للنافذة نفسها.
- الإصلاح: معاملة واحدة تبدأ بقفل استشاري للمهمة، ثم `DELETE … RETURNING` لصفوف النوافذ المنتهية، ثم إلحاق الحدث آخر عبارة؛ وتأخير التفريغ دقيقة بعد انتهاء النافذة.

### A-14. خطوات قبل كتلة `try` في `defineEndpoint`

- الدرجة: منخفضة.
- الموضع: `apps/web/src/server/http/endpoint.ts:139-141`.
- الوصف: `getEnv()` و`clock.refresh()`، وهي قراءة من القاعدة في بيئة العرض، و`computeClientIdHash` تقع قبل `try`. فعند انقطاع القاعدة يخرج الخطأ عن الغلاف الموحد، ويطبعه Next.js بنصه، بدل `log.error` بالصنف والرمز ومعرف الارتباط كما يشترط العقد §5، ويجيب `/healthz` بـ500 بدل 503 الذي يحدده العقد §6.
- الإصلاح: إدخال الخطوات الثلاث في `try`، وإعفاء `/healthz` من `clock.refresh()`.

### A-15. فحص الإقلاع لا يرى بناء العرض إلا في عملية الويب، والوثائق تعد بأكثر مما ينفذ

- الدرجة: منخفضة.
- الموضع: `apps/web/src/server/boot/check.ts:63` يقرأ `process.env.DEMO_ROUTES_BUILT`، وهو ثابت يدرج عند البناء في حزمة Next وحدها (`apps/web/next.config.ts:23-25`)، ويقرأ من بيئة التشغيل في حزم esbuild (`apps/web/scripts/bundle.mjs:60-67`)، ويحاكيه `apps/web/tests/integration/boot.test.ts:70` بمتغير بيئة. والأوامر `seed` و`db-roles` و`verify-events` و`release` لا تشغل فحص الإقلاع، بينما يقول العقد §5 و`docs/production-readiness.md:5` إنه يجري «في كل أمر». والمخالفة `DEMO_ROWS_PRESENT` تعد أربعة جداول فقط (`apps/web/src/server/boot/check.ts:26-31`)، ولا `isDemo` على `Court` ولا `Panel`. و`apps/web/scripts/check-build.mjs:25-32` لا يتحقق إلا من بيان المسارات، لا من غياب كود `src/demo` عن حزم الخادم؛ والاستيراد المؤجل في `apps/web/src/components/shell/demo-slot.tsx:13` قد يبقيه قطعة غير مستعملة في بناء الإنتاج، وهذا غير متيقن لأن `.next` لم يفحص.
- الوصف: الضمان الفعلي اليوم وسم القاعدة الأحادي ورفض المكونات المحاكاة، وكلاهما يعمل في كل عملية. لكن اختبار «مسارات العرض مبنية» يثبت منطق القاعدة لا أثر البناء، والـworker يقلع على صورة عرض في وضع الإنتاج دون أن يرى هذه المخالفة بعينها.
- الإصلاح: ملف علامات يكتبه البناء، مثل `dist-server/build-flags.json` بقيمة `DEMO_BUILD`، تقرؤه كل عملية. وفحص في `check-build.mjs` يبحث في `.next/server` عن علامة فريدة من `src/demo` في بناء غير العرض. وتشغيل الفحص في الأوامر التي تمس القاعدة، أو تصحيح الوثائق.

### A-16. سند إنشاء الحساب كود لا معطى، والحالات المسطرية خارج النواة

- الدرجة: منخفضة.
- الموضع: `packages/core/src/actions.ts:60-73` (`accountCreationBasis`، بعبارة `switch` من المجموعة إلى المادة)، والمجموعة في `packages/core/src/roles.ts:64` و`:91-122`؛ و`apps/web/prisma/schema.prisma:416-429` (`CaseStatus`) و`apps/web/src/server/public/service.ts:14-26` (نسخة يدوية منها).
- الوصف: لا قاعدة إجرائية في المرحلة، فلا أجل ولا رسم ولا شرط، والسند مسند إلى مواد قوبلت بالنص (القرار 19)، فالقاعدة الخامسة محترمة. لكن جدول الإجراءات يعرض لهذا الإجراء دالة لا معطى، فلا يقرؤه مختص قانوني دون قراءة الكود، والسند بلا تاريخ سريان. والحالات المسطرية الاثنتا عشرة معرفة في المخطط، ومنسوخة يدويا في الخدمة، والبرومبت يجعل آلة الحالات في النواة. وهذان نمطان ينبغي ألا تنسخهما المرحلة 1.
- الإصلاح: جدول معطيات `ACCOUNT_CREATION_BASIS: Record<AccountBasisGroup, LegalBasis>` يحيل عليه جدول الإجراءات، وحقل تاريخ سريان في `LegalBasis`. وفي المرحلة 1 تعريف الحالات في النواة، واختبار يقارن بها تعداد Prisma.

### A-17. سجل المسارات يكرر بيانات الولوج يدويا

- الدرجة: منخفضة.
- الموضع: `apps/web/src/server/http/registry.ts:23-128`، ومثاله `:46` (`action: 'account.switch-role'`) مقابل `apps/web/src/app/api/v1/auth/role/route.ts:13` (`orAction`)؛ والاختبار `apps/web/tests/architecture/routes.test.ts:89-102` يقارن المعرف والطريقة والمسار وحدها.
- الوصف: بيانات الولوج مكتوبة مرتين، في التعريف وفي السجل، ومصفوفة الرفض تبني توقعاتها على السجل. فإضعاف ولوج مسار تكشفه المصفوفة، أما تغيير `recentAuthMinutes` أو الإجراء نفسه فلا يكشفه شيء.
- الإصلاح: أن يعرض `EndpointHandler` تعريفه كاملا، ومنه `access` و`recentAuthMinutes`، وأن يقارن اختبار المعمار السجل به، أو أن يولد السجل منه.

### A-18. تباعدات صغيرة بين الجداول والوثائق والكود

- الدرجة: منخفضة.
- الموضع والوصف:
  - `apps/web/src/components/shell/TopBar.tsx:35` و`apps/web/src/app/(app)/dashboard/page.tsx:19`: `roleLabelKey(subject.role)` دون درجة المحكمة، فيظهر رئيس محكمة الاستئناف «رئيس المحكمة» لا «الرئيس الأول» (العقد §4.1)، خلافا لصفحة الحساب و`DemoBar.tsx`.
  - `packages/core/src/roles.ts:106`: `ROYAL_COMMISSIONER` بالخيار `court: true`، والقرار 31 وبيانات العرض (`apps/web/src/cli/seed-data/accounts.ts:71`) يجعلانه دون محكمة.
  - `apps/web/src/components/shell/TopBar.tsx:41`: إحالة على `/api/v1/identity/logo`، ولا مسار بهذا الاسم.
  - `apps/web/src/server/public/service.ts:88`: صيغة رقم الملف تبنى يدويا بدل `formatCaseNumber` من النواة.
  - `apps/web/src/server/auth/login.ts:314`: الحد `maxResends = 3` خارج `SECURITY_POLICY` وخارج القرار 12.
  - `apps/web/src/server/notifications/service.ts:104-109`: الحدث `notification.read` يكتب ولو لم يتغير الصف.
  - `apps/web/src/server/accounts/service.ts:97-125` و`:161-172`: إضافة صفة إلى حساب قائم تدون `admin.account.created` بحقل `newUserId` لحساب غير جديد.
  - `docs/data-model.md:78`: الحالة `REGISTERED` «مسجل»، والقرار 21 جعلها «مقيد».
  - `docs/security/findings.md` غير موجود، ويحيل عليه القرار 18 والمذكرة §5 و`docs/production-readiness.md:38`.
- الإصلاح: تمرير درجة المحكمة إلى `roleLabelKey` في الموضعين؛ و`court: false` للمفوض الملكي أو محكمة إدارية نموذجية؛ وحذف الإحالة على الشعار أو إسنادها إلى مسار في المرحلة 9؛ واستعمال `formatCaseNumber`؛ ونقل حد إعادة الإرسال إلى السياسة؛ وإلحاق الحدث حين يتغير الصف فقط؛ وحدث مستقل لإضافة صفة، مثل `admin.role.granted`؛ وتحديث الوثيقة؛ وإنشاء `docs/security/findings.md` بما وعدت به الوثائق.

## 3. جدول التحقق من القواعد المعمارية

| القاعدة | الحكم | الدليل |
| --- | --- | --- |
| النواة لا تستورد غير `zod` و`node:crypto` وملفاتها، ولا تعرف الويب ولا القاعدة | محترمة | `packages/core/src/events.ts:5` و`packages/core/src/event-chain.ts:5` هما الاستيرادان الخارجيان الوحيدان؛ `packages/core/test/architecture.test.ts`؛ `eslint.config.mjs:134-150` |
| مسار صلاحيات واحد عبر `authorize` للمسارات والصفحات والإجراءات المتاحة | محترمة مع ملاحظة | `apps/web/src/server/http/endpoint.ts:222-244`؛ `apps/web/src/server/permissions/guard.ts:110`؛ الاستثناءات في A-04 |
| الشاشات لا تحمل قاعدة معطيات ولا قاعدة عمل | محترمة مع ملاحظة | القاعدة 2 في `apps/web/tests/architecture/code-rules.test.ts`؛ `eslint.config.mjs:151-157`؛ شرط الزر في `apps/web/src/app/(app)/admin/accounts/page.tsx:76` (A-04) |
| كل مكون مؤقت خلف واجهة داخلية لها اختبار عقد | مخروقة | الواجهتان في `apps/web/src/server/messaging/provider.ts` و`apps/web/src/server/identity/provider.ts`، واختبار العقد لا يشغل (A-02) |
| لا قاعدة قانونية في الكود | محترمة مع ملاحظة | لا أجل ولا رسم في الكود؛ القيم التقنية في `packages/core/src/security-policy.ts` مدونة في القرار 12؛ السند دالة (A-16) |
| لا قراءة لساعة النظام خارج `apps/web/src/server/clock.ts`، و`systemNow` من قائمته المغلقة وحدها | محترمة مع ملاحظة | القاعدة 4 في `apps/web/tests/architecture/code-rules.test.ts` ناجحة؛ `eslint.config.mjs:13-30`؛ خلط المرجعين في A-10 |
| لا نص عربي في الكود خارج ملفات الرسائل وبيانات العرض | محترمة | القاعدة 5 في `apps/web/tests/architecture/code-rules.test.ts` ناجحة؛ ما بقي من العربية في الكود تعليقات فقط |
| عزل أدوات العرض، وإقصاؤها عند البناء، ورفض الإقلاع في التشغيل الفعلي | محترمة مع ملاحظة | `apps/web/next.config.ts:22`؛ `apps/web/scripts/check-build.mjs:25-32`؛ `apps/web/src/demo/server/services.ts:10-12`؛ `packages/core/src/boot.ts:105-107`؛ الاستيراد من `src/demo` مؤجل ومن المداخل الثلاثة وحدها (القاعدة 3 ناجحة)؛ A-15 |
| كل مسار برمجي منتج `defineEndpoint` ومسجل، ولا مدخل في السجل بلا ملف | محترمة | `apps/web/tests/architecture/routes.test.ts` ناجح كله؛ تكرار بيانات الولوج في A-17 |
| كل صفحة تبدأ بحارس واحد ومسجلة في سجل الصفحات | محترمة مع ملاحظة | `apps/web/tests/architecture/pages.test.ts`: الصفحات كلها ناجحة، والتخطيطان المنتظران غائبان (A-03) |
| فهرس الأحداث مغلق، وكل مسار مغير للحالة يدون حدثا عند النجاح | محترمة مع ملاحظة | كل صنف في `packages/core/src/events.ts` مستعمل، وكل مستعمل في الفهرس؛ كل مسار POST يلحق حدثا عند نجاحه؛ رفض غير مدون في A-05 |
| السجل لا يعدل ولا يمحى في القاعدة نفسها، والجداول الوحيدة الصف مقيدة | محترمة | `apps/web/prisma/migrations/20261124121755_foundation/migration.sql:495-512` (قوادح التعديل والحذف والإفراغ)، و`:516-568` (`CHECK ("id" = 1)`، والوسم الأحادي، والساعة التي لا ترجع)؛ `apps/web/src/cli/db-roles.ts:69-104` |
| نموذج المعطيات مطابق لـ`docs/data-model.md` | محترمة مع ملاحظة | الجداول والأعمدة متطابقة؛ مرجع الزمن في `lastLoginAt` وتسمية «مسجل» في A-10 وA-18 |
| دور التشغيل لا يملك السجل، والدور المالك للهجرات والتهيئة وحدها | مخروقة | الكود سليم (`apps/web/src/cli/db-roles.ts`، `apps/web/src/server/boot/check.ts:17-23`)، والإعداد يعطي عملية الويب رابط الدور المالك (A-01) |
| صورة Docker: مراحل، وأساس مثبت بالبصمة، ومستعمل غير الجذر، ولا سر | محترمة | `Dockerfile:7`، و`Dockerfile:9-25`، و`Dockerfile:27-46`؛ `.dockerignore` |
| `.railway/railway.ts` يجتاز فحص الأنواع، وأوامره ومراجعه صحيحة الشكل، ولا تنحرف الأسرار بين الخدمتين | محترمة مع ملاحظة | `npx tsc -p tsconfig.json --noEmit` ناجح؛ `preDeploy` و`healthcheck` و`start` مطابقة لـ`IntentServiceConfig`؛ أسرار `worker` مراجع إلى `web` (`.railway/railway.ts:68-70`)؛ غياب `drainingSeconds` في A-11 |
| سلسلة CI: البيئة، وخدمة PostgreSQL، والأسرار لكل تشغيل، وتثبيت الإجراءات، والصلاحيات | محترمة مع ملاحظة | `.github/workflows/ci.yml`: `permissions: contents: read`، والإجراءات مثبتة ببصمات الالتزام، و`persist-credentials: false`، والبناء ببيئة فارغة؛ `.github/scripts/ci-database.sh` يولد الأسرار ويخفيها؛ لكن CI لا ينجح (A-03) |
| المتانة: المعاملات، وقفل السجل، ومعالجة الأخطاء، والذاكرة المؤقتة، وحد Argon2، والـworker | محترمة مع ملاحظة | `appendEvent` آخر عبارة في كل معاملة؛ المهل في `apps/web/src/server/db.ts:19`؛ حد Argon2 في `apps/web/src/server/auth/passwords.ts:17-31`؛ A-06 وA-07 وA-08 وA-11 إلى A-14 |

## 4. ما وجده المراجع سليما

- النواة نقية، وجداولها تصريحية، ومصفوفة الصلاحيات في الاختبار مكتوبة مستقلة عن الجدول، والثوابت الدائمة مختبرة: مدبر النظام والمختص القانوني لا يطلعان على مضمون ملف، والإجراء المجهول مرفوض، و`availableActions` لا تتجاوز `authorize`.
- `defineEndpoint` يطبق الخطوات الإحدى عشرة بترتيب العقد، ويدون كل رفض عبر حد الرفض، ويجيب عن الخطأ غير المتوقع بمعرف ارتباط دون نصه.
- سلسلة البصمات مفتاحية، والصيغة المعيارية للحدث التي تحسب عليها البصمة حتمية (مفاتيح مرتبة، وأعداد صحيحة وحدها، وأزمنة بالمليثانية)، و`appendEvent` يأخذ القفل بـ`$executeRaw` ويقرأ الرأس تحت القفل ويأخذ `recordedAt` من `clock_timestamp()`.
- القوادح في القاعدة نفسها، والجداول الوحيدة الصف مقيدة بـ`CHECK`، والوسم أحادي الاتجاه، والساعة لا ترجع، و`db-roles` يتحقق في آخره من أن دور التشغيل لا يملك السجل ولا يعدله.
- لا شيء في `apps/web/src/server` يقرأ البيئة أو يفتح اتصالا عند التحميل، والبناء في CI ينجح ببيئة فارغة (`env -i`).
- لا عربية في الكود خارج موضعيها، ولا قراءة لساعة النظام خارج `clock.ts`، ولا `style=` ولا `dangerouslySetInnerHTML` ولا `'use server'`، ولا SQL مبني بضم النصوص.
- كل صنف في فهرس الأحداث مستعمل، وكل مسار POST يلحق حدثا عند نجاحه، والتفاصيل مخططات مغلقة لا تقبل نصا حرا.
- لا استعلامات N+1 ذات أثر: القوائم محدودة بـ`take`، والعلاقات تجلب دفعة واحدة.
- `Dockerfile` متعدد المراحل، وأساسه مثبت ببصمته، ويشتغل بالمستعمل `node`، ولا يضمن سرا.
- CI بصلاحية القراءة وحدها، وإجراءاته مثبتة ببصماتها، وgitleaks يتحقق من بصمته قبل التشغيل، والأسرار مولدة لكل تشغيل ومخفية في السجلات.
- `.railway/railway.ts` يجتاز فحص الأنواع مقابل `railway/iac`، ولا يولد سرا (`preserve()` لا `ctx.randomString()`)، ولا يفتح نطاقا عاما ولا TCP proxy على القاعدة، وأسرار `worker` مأخوذة من `web` بالإحالة فلا تنكسر السلسلة بين الخدمتين.
