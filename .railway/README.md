# النشر على Railway

يصف `.railway/railway.ts` بنية بيئة العرض على Railway، وهي:

- قاعدة PostgreSQL باسم `postgres`، دون نطاق عام ودون TCP proxy.
- مستودع وثائق باسم `documents` في منطقة `ams`، ولا تستعمله المرحلة 0 بعد.
- خدمة `web` تبنى من `Dockerfile` بمسارات العرض (`DEMO_BUILD=true`). ينفذ قبل كل نشر `node dist-server/release.mjs`، أي الهجرات وتهيئة دور التشغيل وبيانات العرض دون إعادة تهيئة. وفحص الصحة على `/healthz`.
- خدمة `worker` من الصورة نفسها، تشغل `node dist-server/worker.mjs` وتعاد عند كل توقف.

ولا يقرأ Railway مجلد `.railway/` أثناء النشر. وتطبق البنية بأمر `railway config apply`، أو بسير العمل `railway-config.yml` عند دمج طلب دمج يمس هذا المجلد.

## النشر الأول (يقوم به مالك المشروع)

1. إنشاء مشروع على Railway، وتثبيت تطبيق Railway على GitHub مع الإذن بالمستودع `tatbikk/voice-translator`.
2. تثبيت Railway CLI (الإصدار 5.42.1 فما فوق)، وربط نسخة المستودع المحلية بالمشروع بأمر `railway link`.
3. إنشاء متغير مشترك (Project Settings ثم Shared Variables) باسم `APP_DB_PASSWORD`، وقيمته من `openssl rand -hex 24`، مع ختمه (sealed).
4. من جذر المستودع: `railway config plan` ثم مراجعة الفرق، ثم `railway config apply`. وفي هذا الفرق الأول يتحقق المالك من ثلاثة أمور: أن مراجع `DATABASE_URL` (`${{shared.APP_DB_PASSWORD}}` و`${{postgres.PGHOST}}` …) تحل كما ينبغي، وأن المتغيرات المحفوظة بـ`preserve()` مقبولة قبل ملئها، وأن الخطة لا تحذف شيئا.
5. ملء أسرار خدمة `web` من لوحة Railway (Variables، مع ختم كل قيمة). وتأخذها خدمة `worker` من `web` بالإحالة:

   | المتغير | طريقة التوليد |
   | --- | --- |
   | `SESSION_SECRET` | `openssl rand -base64 48` |
   | `SECRETS_MASTER_KEY` | `openssl rand -base64 32` |
   | `ACCESS_CODE` | `openssl rand -hex 16`، وهي كلمة عبور الزوار التي تعطى لمن يجرب المنصة |
   | `SEED_DEMO_PASSWORD` | كلمة مرور حسابات العرض، من اثني عشر حرفا فأكثر |

   ولا يولد سر في `railway.ts` (فـ`ctx.randomString()` قابل للتوقع)، ولا يكتب سر في المستودع.
6. توليد نطاق عام لخدمة `web` (Settings ثم Networking ثم Generate Domain). ويأخذ `APP_URL` قيمته من `RAILWAY_PUBLIC_DOMAIN` تلقائيا.
7. تفعيل النسخ الاحتياطي اليومي لقاعدة المعطيات من صفحة الخدمة `postgres` (Backups)، واختيار منطقة أوروبية للخدمات.
8. إنشاء رمز مشروع (Project Token) وحفظه في المستودع على GitHub سرا باسم `RAILWAY_TOKEN`، ليستعمله سير العمل `railway-config.yml`.
9. الإذن بالدفع إلى `main`. وتنشر الخدمتان من `main` بعد نجاح CI (`checkSuites: true`).

## التحقق بعد النشر

```
curl -fsS https://<النطاق>/healthz
cd apps/web && E2E_BASE_URL=https://<النطاق> ACCESS_CODE=… SEED_DEMO_PASSWORD=… npx playwright test
```

ولا يمس اختبار المسار على النسخة المنشورة قاعدة المعطيات مباشرة: يدخل كما يدخل الزائر.

## ما لا يفعل أبدا

- لا `prisma migrate reset` ولا `db push --force-reset` على أي قاعدة.
- لا TCP proxy ولا نطاق عام على قاعدة المعطيات.
- لا `DEMO_TOOLS=true` ولا `DEMO_BUILD=true` في وضع الإنتاج، فالتطبيق يرفض الإقلاع حينئذ.
- لا إعادة تهيئة لبيانات العرض من النشر الآلي. فإعادة التهيئة يدوية وتطلب اسم القاعدة صراحة.
