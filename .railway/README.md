# النشر على Railway

يصف `.railway/railway.ts` بنية بيئة العرض على Railway، وهي:

- قاعدة PostgreSQL باسم `postgres`، دون نطاق عام ودون TCP proxy.
- حاوية وثائق باسم `documents` في منطقة `ams`، ولا تستعملها المرحلة 0 بعد.
- خدمة إصدار `release` تبنى من `Dockerfile`، وتنفذ عند كل نشر `node dist-server/release.mjs` مرة واحدة ثم تتوقف: الهجرات، ثم تهيئة دور التشغيل، ثم بيانات العرض دون إعادة تهيئة. وهي وحدها تحمل رابط الدور المالك لقاعدة المعطيات وكلمة سر حسابات العرض.
- خدمة الويب، واسمها في المشروع `voice-translator` لأنها سبقت هذا الملف، من الصورة نفسها بمسارات العرض (`DEMO_BUILD=true`)، وفحص الصحة على `/healthz`. ولا تحمل إلا دور التشغيل، وترفض الإقلاع ما لم تطبق خدمة الإصدار هجرات النسخة، فيعاد تشغيلها إلى أن تطبق.
- خدمة `worker` من الصورة نفسها، تشغل `node dist-server/worker.mjs` ويعاد تشغيلها عند كل توقف.

ولا يقرأ Railway مجلد `.railway/` أثناء النشر. وتطبق البنية بأمر `railway config apply`، أو بسير العمل `railway-config.yml` عند دمج طلب دمج يمس هذا المجلد.

## النشر الأول (يقوم به مالك المشروع)

1. إنشاء مشروع على Railway، وتثبيت تطبيق Railway على GitHub مع الإذن بالمستودع `tatbikk/voice-translator`.
2. تثبيت Railway CLI (الإصدار 5.42.1 فما فوق)، وربط نسخة المستودع المحلية بالمشروع بأمر `railway link`.
3. إنشاء متغير مشترك (Project Settings ثم Shared Variables) باسم `APP_DB_PASSWORD`، وقيمته من `openssl rand -hex 24`، مع ختمه (sealed).
4. من جذر المستودع: `railway config plan` ثم مراجعة الفرق، ثم `railway config apply`. وفي هذا الفرق الأول يتحقق المالك من ثلاثة أمور: أن مراجع `DATABASE_URL` (`${{shared.APP_DB_PASSWORD}}` و`${{postgres.PGHOST}}` …) تحل كما ينبغي، وأن المتغيرات المحفوظة بـ`preserve()` مقبولة قبل ملئها، وأن الخطة لا تحذف شيئا.
5. ملء الأسرار من لوحة Railway، مع ختم كل قيمة. وهي متغيرات مشتركة في المشروع تحيل عليها الخدمات كلها، إلا كلمة سر حسابات العرض فهي في خدمة `release` وحدها:

   | المتغير | الموضع | طريقة التوليد |
   | --- | --- | --- |
   | `SESSION_SECRET` | مشترك | `openssl rand -base64 48` |
   | `SECRETS_MASTER_KEY` | مشترك | `openssl rand -base64 32` |
   | `ACCESS_CODE` | مشترك | `openssl rand -hex 16`، وهي كلمة عبور الزوار التي تعطى لمن يجرب المنصة |
   | `SEED_DEMO_PASSWORD` | `release` | كلمة سر حسابات العرض، من اثني عشر حرفا فأكثر |

   ولا يولد سر في `railway.ts` (فـ`ctx.randomString()` قابل للتوقع)، ولا يكتب سر في المستودع.
6. توليد نطاق عام لخدمة `web` (Settings ثم Networking ثم Generate Domain). ويأخذ `APP_URL` قيمته من `RAILWAY_PUBLIC_DOMAIN` تلقائيا.
7. تفعيل النسخ الاحتياطي اليومي لقاعدة المعطيات من صفحة الخدمة `postgres` (Backups)، واختيار منطقة أوروبية للخدمات.
8. إنشاء رمز مشروع (Project Token) وحفظه في المستودع على GitHub سرا باسم `RAILWAY_TOKEN`، ليستعمله سير العمل `railway-config.yml`.
9. الإذن بالدفع إلى `main`. وتنشر الخدمات من `main` بعد نجاح CI (`checkSuites: true`).

## التحقق بعد النشر

```
curl -fsS https://<النطاق>/healthz
cd apps/web && E2E_BASE_URL=https://<النطاق> ACCESS_CODE=… SEED_DEMO_PASSWORD=… npx playwright test
```

ولا يمس اختبار المسار على النسخة المنشورة قاعدة المعطيات مباشرة: يدخل كما يدخل الزائر. وتعطي الحافة كل الطلبات عنوانا واحدا، فيلزم تشغيله في فترات متباعدة حتى لا يبلغ حد الدخول لكل عميل.

## ما لا يفعل أبدا

- لا `prisma migrate reset` ولا `db push --force-reset` على أي قاعدة.
- لا TCP proxy ولا نطاق عام على قاعدة المعطيات.
- لا رابط للدور المالك في خدمتي `web` و`worker`: فالتطبيق يرفض الإقلاع حينئذ.
- لا `DEMO_TOOLS=true` ولا `DEMO_BUILD=true` في وضع التشغيل الفعلي، فالتطبيق يرفض الإقلاع حينئذ.
- لا إعادة تهيئة لبيانات العرض من النشر الآلي. فإعادة التهيئة يدوية وتطلب اسم القاعدة صراحة.
