# Phase 0 — engineering contract

This file is the binding technical contract for everything built in Phase 0
(`المرحلة 0: التأسيس والأمان والنشر الأول`). The human-facing plan is
`docs/phases/phase-0.md`; the threat model is `docs/security/phase-0-memo.md`.
The founding prompt is `docs/build-prompt.md` and wins over this file.

Code, identifiers and comments are English. Every string a user reads is Arabic
and lives in `apps/web/src/i18n/messages/ar.json` (never in code).

If something here turns out to be technically impossible with the current
versions of the tools, pick the simplest working alternative and record it in
`docs/decisions.md` (Arabic, one entry: القرار، السبب، البديل المتروك).

## 1. Toolchain

| Item | Choice |
| --- | --- |
| Runtime | Node 22 (`engines.node >=22`) |
| Package manager | npm workspaces (`apps/*`, `packages/*`), single `package-lock.json`, exact versions (`save-exact=true` in `.npmrc`) |
| Language | TypeScript, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`. Latest stable that the rest of the toolchain accepts. |
| Web | Next.js latest stable (16.x), App Router, React 19, no Server Actions (all mutations go through `/api/v1`) |
| DB | PostgreSQL 16+, Prisma latest *stable* (7.x — the `latest` dist-tag is an 8.0 RC, do not use it), `@prisma/adapter-pg` |
| Validation | zod 4 |
| CSS | Tailwind CSS 4, logical properties only (`ps-*`, `pe-*`, `ms-*`, `text-start`…) |
| UI primitives | `radix-ui` (Dialog/AlertDialog, DropdownMenu, Tabs) wrapped in our own components |
| Fonts | `@fontsource-variable/noto-naskh-arabic` (headings, documents) and `@fontsource/ibm-plex-sans-arabic` (interface), bundled with the app, no external request |
| Password hashing | `@node-rs/argon2`, Argon2id |
| Unit/integration tests | Vitest |
| E2E | Playwright (`@playwright/test`); config reads `PW_CHROMIUM_PATH` for `launchOptions.executablePath` when set |
| Worker/CLI build | esbuild bundle of `src/worker/main.ts` and `src/cli/*.ts` into `apps/web/dist-server/` |
| Lint | ESLint flat config + `typescript-eslint` strict type-checked |

Local services (already running in the build container):
PostgreSQL on `localhost:5432`, role `mahkama` / password `mahkama_local_dev`,
databases `mahkama_dev` and `mahkama_test`. Docker daemon is available.

## 2. Repository layout

```
package.json  package-lock.json  tsconfig.base.json  eslint.config.mjs  .npmrc
.env.example  .gitignore  .dockerignore  .gitleaks.toml  Dockerfile
.railway/railway.ts
.github/workflows/ci.yml
packages/core/               @mahkama/core — pure TS, no web, no DB
  src/{roles,actions,authorize,available-actions,clock,event-chain,boot,
       auth-policy,case-number,components,errors,index}.ts
  test/*.test.ts
apps/web/                    @mahkama/web
  next.config.ts  prisma.config.ts  postcss.config.mjs  vitest.config.ts  playwright.config.ts
  prisma/schema.prisma  prisma/migrations/<timestamp>_<name>/migration.sql
  src/proxy.ts               access gate + CSP nonce + security headers (Next 16 "proxy", formerly middleware)
  src/instrumentation.ts     boot check
  src/app/                   routes (pages + /api/v1 + /healthz)
  src/components/ui/         component library
  src/components/shell/      top bar, navigation, demo indicator, logo slot
  src/i18n/                  messages/{ar,fr,zgh}.json, t(), locale handling
  src/server/                server-only services (see §5)
  src/demo/                  demo tools, isolated module (see §9)
  src/worker/main.ts
  src/cli/{seed,verify-events,boot-check}.ts
  tests/integration/         Vitest against mahkama_test
  tests/e2e/                 Playwright
docs/
```

Import rules (enforced by ESLint `no-restricted-imports` and by an architecture test):

- `packages/core` imports nothing but `node:crypto`. No `next`, `react`, `@prisma/*`, `pg`, nothing from `apps/`.
- `apps/web/src/components/**` and `src/app/**` pages never import `@/server/db` or Prisma directly; they call query/service functions in `src/server/**`.
- Nothing outside `src/demo/**` imports from `src/demo/**`, except the two entry points listed in §9 (lazy `import()` only).
- `new Date()` without arguments, `Date.now()`, `performance.now()` are banned everywhere except `apps/web/src/server/clock.ts` and test files.
- No Arabic-script string literal in `*.ts`/`*.tsx` outside `src/i18n/messages/**`, `src/cli/seed-data/**` and tests.

## 3. Environment variables

Validated once by `src/server/config/env.ts` (zod). Names documented in `.env.example` without values.

| Name | Meaning |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | ≥ 32 random bytes (base64). HMAC key for cookies, CSRF tokens, IP hashing |
| `APP_URL` | Public origin, e.g. `https://…up.railway.app`. Must be https unless host is `localhost` |
| `APP_MODE` | `demo` or `production` |
| `SECRETS_MASTER_KEY` | 32 bytes base64. AES-256-GCM key for secrets stored in the DB |
| `AI_EXTERNAL_ALLOWED` | `true`/`false`. Read in Phase 8; validated now |
| `ACCESS_CODE` | Visitor passphrase. Mandatory when `APP_MODE=demo` |
| `DEMO_TOOLS` | `true`/`false`. Only honoured when `APP_MODE=demo` |
| `S3_ENDPOINT` `S3_REGION` `S3_BUCKET` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` | Document bucket. Optional in Phase 0 (nothing stores documents yet) |
| `SEED_DEMO_PASSWORD` | Password given to seeded demo accounts. Read only by the seed CLI |
| `SESSION_IDLE_MINUTES` | Optional, default 30 |
| `LOG_LEVEL` | Optional, default `info` |

No secret has a default value. Missing/invalid configuration stops the process with a message naming the variable (never its value).

## 4. packages/core

Pure functions and declarative tables. Every exported function is unit-tested.

### roles.ts

`RoleCode` union and `ROLES` table (`code`, `space`, `labelKey`, `requiresCourt`, `requiresOrganization`, `professional`).

| RoleCode | Arabic (labelKey value) | Space |
| --- | --- | --- |
| `LAWYER` | محام | lawyer |
| `LAWYER_ASSISTANT` | مساعد مكتب المحاماة | lawyer |
| `CLERK_REGISTRATION` | كتابة الضبط — مكتب التقييد | clerk |
| `CLERK_CASHIER` | كتابة الضبط — الصندوق | clerk |
| `CLERK_NOTIFICATION` | كتابة الضبط — مكتب التبليغ | clerk |
| `CLERK_HEARING` | كاتب الجلسة | clerk |
| `CLERK_COPIES_ENFORCEMENT` | كتابة الضبط — مكتب النسخ والتنفيذ | clerk |
| `CHIEF_CLERK` | رئيس كتابة الضبط | clerk |
| `COURT_PRESIDENT` | رئيس المحكمة | court_president |
| `JUDGE_RAPPORTEUR` | القاضي المقرر | judge_rapporteur |
| `COUNSELLOR_RAPPORTEUR` | المستشار المقرر | judge_rapporteur |
| `PANEL_PRESIDENT` | رئيس الهيئة | panel |
| `PANEL_MEMBER` | عضو الهيئة | panel |
| `PUBLIC_PROSECUTOR` | النيابة العامة | prosecution |
| `ROYAL_COMMISSIONER` | المفوض الملكي للدفاع عن القانون والحق | prosecution |
| `BAILIFF` | المفوض القضائي | bailiff |
| `EXPERT` | الخبير | expert |
| `ENFORCEMENT_JUDGE` | قاضي التنفيذ | enforcement_judge |
| `LITIGANT` | المتقاضي | litigant |
| `PUBLIC_ADMINISTRATION` | الإدارة العمومية | public_administration |
| `STATE_JUDICIAL_AGENT` | الوكيل القضائي للمملكة | public_administration |
| `GARNISHEE_BANK` | البنك المحجوز لديه | bank |
| `SYSTEM_ADMIN` | مدبر النظام | system_admin |

Thirteen spaces (`SpaceCode`): lawyer, clerk, court_president, judge_rapporteur, panel, prosecution, bailiff, expert, enforcement_judge, litigant, public_administration, bank, system_admin. Roles are never merged.

### actions.ts / authorize.ts / available-actions.ts

One declarative table `ACTIONS: Record<ActionCode, ActionRule>`:

```ts
type ActionLevel = 'HUMAN_DECISION' | 'SCRIPT' | 'AI_ASSIST';
interface ActionRule {
  code: ActionCode;
  level: ActionLevel;
  labelKey: string;              // i18n key
  legalBasis: string | null;     // e.g. 'المادة 628' — null only for platform-administration actions
  roles: readonly RoleCode[] | 'ANY_ACTIVE_USER';
  requires?: readonly Condition[]; // pure predicates over (subject, resource, context)
}
type Subject =
  | { kind: 'anonymous' }
  | { kind: 'user'; userId: string; role: RoleCode; roleAssignmentId: string;
      courtId: string | null; organizationId: string | null; isDemoAccount: boolean };
type Decision =
  | { allowed: true; rule: ActionRule }
  | { allowed: false; reason: 'UNAUTHENTICATED' | 'ROLE_NOT_PERMITTED' | 'CONDITION_NOT_MET' | 'UNKNOWN_ACTION' | 'MODE_NOT_PERMITTED' };

authorize(subject, action, resource?, context?): Decision   // deny by default; unknown action => denied
availableActions(subject, resource?, context?): ActionRule[] // derived from the same table, never a second list
```

`context` carries `{ mode: 'demo' | 'production'; demoToolsEnabled: boolean }`.

Phase 0 action codes:

| Code | Who | Notes |
| --- | --- | --- |
| `dashboard.view` | any active user | |
| `notifications.view-own`, `notifications.mark-read-own` | any active user | resource must belong to subject |
| `account.view-own`, `account.switch-role` | any active user | |
| `admin.accounts.list`, `admin.accounts.create` | `SYSTEM_ADMIN` | create also needs recent re-authentication (enforced by endpoint) |
| `case.content.view` | declared now with an **empty** role list for `SYSTEM_ADMIN` and a relation condition for everybody else that is always false until Phase 1 | invariant test: `SYSTEM_ADMIN` is denied for every `case.*` action, now and in every later phase |
| `demo.account.switch`, `demo.outbox.view`, `demo.clock.view` | anyone past the access gate, **only** when `context.mode === 'demo' && context.demoToolsEnabled`; `demo.account.switch` also requires the target account to be flagged demo | `MODE_NOT_PERMITTED` otherwise |

### clock.ts

`interface Clock { now(): Date; systemNow(): Date }`, `MOROCCO_TZ = 'Africa/Casablanca'`,
`formatMoroccoDate(date, locale)` (months named as in Morocco: يناير، فبراير، مارس، أبريل، ماي، يونيو، يوليوز، غشت، شتنبر، أكتوبر، نونبر، دجنبر), `formatMoroccoTime`, `fixedClock(date)` for tests.

`now()` is platform (legal) time. `systemNow()` is real elapsed time used only for
security timers (session expiry, lockouts, rate limits, one-time-code validity).
In production mode both are identical.

### event-chain.ts

```ts
interface EventRecord { seq: number; id: string; occurredAt: string; recordedAt: string;
  actorUserId: string | null; actorRole: string | null; action: string; outcome: 'DONE' | 'DENIED' | 'FAILED';
  caseFileId: string | null; legalBasis: string | null; details: Record<string, JsonValue> }
canonicalize(record): string            // stable key order, no whitespace, ISO dates
computeEventHash(prevHash: string, record: EventRecord): string  // sha256 hex of prevHash + '\n' + canonicalize(record)
GENESIS_HASH = '0'.repeat(64)
verifyChain(rows: Iterable<EventRecord & { prevHash: string; hash: string }>): { ok: true; count: number } | { ok: false; brokenAtSeq: number; reason: 'HASH_MISMATCH' | 'PREV_HASH_MISMATCH' | 'SEQ_GAP' }
```

### boot.ts

`evaluateBoot(input): { ok: true } | { ok: false; violations: BootViolation[] }` with

```ts
input = { mode, demoToolsEnabled, accessCodeSet, appUrl, sessionSecretBytes, masterKeyBytes,
          components: { id: string; implementation: 'simulated' | 'real' | 'test' }[],
          demoDataPresent: boolean, aiExternalAllowed: boolean }
```

Production mode is refused when: any component is `simulated` or `test`; demo tools are enabled; demo data is present; `appUrl` is not https. Any mode is refused when: secrets too short; `mode==='demo'` and no access code; a `test` component is registered.

### auth-policy.ts

Pure decision functions over attempt history (`{ at: Date; ok: boolean }[]`) and `now`:

- password: 5 failures within 15 min ⇒ account locked 15 min.
- second factor: code valid 5 min, 5 wrong codes on a challenge ⇒ challenge void and account locked 15 min; at most 3 resends per pending session.
- signature PIN (used from Phase 1): same shape, 3 failures ⇒ 15 min.
- access code: 10 failures / 15 min per client ⇒ blocked 15 min.
- public case lookup: 10 lookups / 5 min per client.
- unauthenticated refusals logged per client: at most 30 / min, the 31st is answered 429 and logged once as `access.throttled`.

All thresholds live in one exported `SECURITY_POLICY` constant (technical values, documented in `docs/decisions.md`).

### case-number.ts

`formatCaseNumber({ number, code, year })` ⇒ `"1234/8201/2026"`; `parseCaseNumber(text)` (accepts Arabic-Indic digits, trims, validates ranges).

### components.ts

`ReplaceableComponent { id; nameKey; interfaceName; implementation: 'simulated' | 'real' | 'test'; replacedByKey; requirementKey }` — the descriptor type used by the server-side registry and by `evaluateBoot`.

## 5. apps/web/src/server

All modules start with `import 'server-only'` (except those shared with the worker/CLI bundle — use a `server-only` shim alias in the esbuild build and Vitest config).

- `config/env.ts` — zod-validated env, `isDemo()`, `demoToolsEnabled()`.
- `log.ts` — JSON line logger. Never logs request bodies, document contents, personal data, cookies, tokens or secrets: identifiers only. A redaction test proves that known secret values never reach the output.
- `db.ts` — Prisma client singleton (pg adapter).
- `clock.ts` — the only file allowed to read system time. `clock.now()` = system time + offset read from table `PlatformClock` (offset is always 0 and never read in production mode); `clock.systemNow()`. `advancePlatformClock()` is **not** here: it lives in `src/demo`.
- `events/append.ts` — `appendEvent(tx, input)`: takes `pg_advisory_xact_lock`, reads the head, assigns `seq = head.seq + 1`, computes hash with core, inserts. Must be called inside the same transaction as the change it records whenever there is one. `events/verify.ts` — streams the table and calls core `verifyChain`.
- `auth/passwords.ts` (Argon2id: memory ≥ 19 MiB, t=2, p=1; `needsRehash`), `auth/sessions.ts`, `auth/login.ts`, `auth/second-factor.ts`, `auth/lockout.ts`, `auth/access-gate.ts`, `auth/csrf.ts`, `auth/reauth.ts`, `auth/activation.ts`, `auth/client-id.ts` (HMAC of client IP — raw IP is never stored).
- `permissions/guard.ts` — builds the core `Subject` from the session, calls core `authorize`, appends `access.denied` event on refusal. `requirePage(action, resource?)` for server components, used at the top of **every** page under the authenticated area.
- `http/endpoint.ts` — `defineEndpoint` (see §6). `http/registry.ts` — list of every endpoint (id, method, path, access) for the refusal matrix test.
- `messaging/` — `MessagingProvider` interface, `simulated-outbox.ts`, `contract.ts` (reusable contract test suite).
- `identity/` — `ProfessionalIdentityProvider` interface, `simulated.ts`, `contract.ts`.
- `secrets/store.ts` — AES-256-GCM, random 12-byte IV, AAD = setting name, stores `ciphertext`, `iv`, `tag`, `last4`; `put`, `getPlaintextForUse` (server-internal, never serialised), `describe` (returns label + last4 only).
- `components/registry.ts` — the replaceable components that exist in the code today, for `evaluateBoot` and for the «مكونات بيئة العرض» page.
- `boot/check.ts` — gathers facts, calls core `evaluateBoot`, logs violations (codes, no values) and exits non-zero.
- `jobs/queue.ts` — PostgreSQL job queue: `enqueue(tx, type, payload, { runAt })`, worker loop with `FOR UPDATE SKIP LOCKED`, retries with backoff, `runAt` compared with `clock.now()`.
- `notifications/`, `accounts/`, `dashboard/`, `public/` — query and command services.

## 6. HTTP contract

Every route file under `src/app/api/**/route.ts` and `src/app/healthz/route.ts` exports handlers built by `defineEndpoint`. Handlers are plain `(req: Request) => Promise<Response>` and read cookies from `req.headers` (never `next/headers`), so integration tests call them directly.

```ts
defineEndpoint({
  id: 'admin.accounts.create', method: 'POST', path: '/api/v1/admin/accounts',
  access: { kind: 'action', action: 'admin.accounts.create' }
        // | { kind: 'public' }          healthz only: no gate, no session
        // | { kind: 'gate' }            needs the visitor access cookie only (access page itself is 'pre-gate')
        // | { kind: 'pending-session', state: 'PENDING_SECOND_FACTOR' | 'PENDING_ROLE' }
        // | { kind: 'demo', action: 'demo.outbox.view' }
  recentAuthMinutes?: 10,
  input: zodSchema,
  handler: async ({ input, subject, session, req }) => Response-like result,
})
```

Order of checks inside the wrapper, each failing closed:

1. Mode: `demo` endpoints answer 404 unless demo mode **and** demo tools are enabled (checked on every request).
2. Access gate cookie (unless `public`/`pre-gate`) ⇒ 401 `ACCESS_CODE_REQUIRED`.
3. For non-GET: `Origin` must equal `APP_URL` origin, `Sec-Fetch-Site` (when present) must be `same-origin`, and `X-CSRF-Token` must match ⇒ 403 `CSRF_REJECTED`.
4. Session: resolve by cookie, check state, idle timeout, absolute expiry ⇒ 401 `SESSION_REQUIRED`.
5. Authorisation through core `authorize` ⇒ 403 `FORBIDDEN` (role) or 404 `NOT_FOUND` (resource the caller must not learn about). Refusal appended to the event log.
6. Recent re-authentication when requested ⇒ 403 `REAUTH_REQUIRED`.
7. Input parsed with zod ⇒ 422 `INVALID_INPUT` with `fields: { name: messageKey }`.
8. Handler. Unexpected errors ⇒ 500 `INTERNAL` with a correlation id, nothing else.

Response envelope: `{ ok: true, data }` or `{ ok: false, error: { code, messageKey, fields? } }`. `messageKey` is an i18n key; the client renders the Arabic text.

Cookies (prefix `__Host-` when `APP_URL` is https, no prefix on `http://localhost`):

| Cookie | Content | Flags |
| --- | --- | --- |
| `mr-access` | `v1.<expiresEpoch>.<hmac>` — 12 h | HttpOnly, Secure, SameSite=Lax, Path=/ |
| `mr-session` | opaque 32-byte random token (base64url); DB stores only its SHA-256 | HttpOnly, Secure, SameSite=Lax, Path=/ |
| `mr-csrf` | anonymous CSRF binding id used before a session exists | HttpOnly, Secure, SameSite=Lax, Path=/ |
| `mr-locale` | `ar` \| `fr` \| `zgh` | Secure, SameSite=Lax, Path=/ |

CSRF token = base64url(HMAC-SHA256(SESSION_SECRET, `csrf|` + bindingId)) where bindingId is the session id when a session cookie resolves, else the `mr-csrf` value. Pages embed it in `<meta name="csrf-token">`; the client fetch helper sends it as `X-CSRF-Token`.

Endpoints:

| Method | Path | Access | Behaviour |
| --- | --- | --- | --- |
| GET | `/healthz` | public | `SELECT 1`; 200 `{status:'ok'}` or 503 `{status:'unavailable'}`. Nothing else in the body |
| POST | `/api/v1/access` | pre-gate | `{ code }`. Constant-time compare. Sets `mr-access`. 10 failures/15 min per client ⇒ 429 `TOO_MANY_ATTEMPTS`. Every attempt logged (`access.code.accepted` / `access.code.rejected`) |
| POST | `/api/v1/auth/login` | gate | `{ email, password }`. Same response, status and (approximately) timing for unknown e-mail and wrong password: 401 `INVALID_CREDENTIALS`. Locked account ⇒ 423 `ACCOUNT_LOCKED` with `retryAfterSeconds` (only after correct identification of an existing locked account is impossible to distinguish from failure for unknown e-mails: unknown e-mails are tracked by client id and locked the same way). On success creates a session in state `PENDING_SECOND_FACTOR`, issues a 6-digit code (stored hashed) through `MessagingProvider`, returns `{ next: 'second-factor' }` |
| POST | `/api/v1/auth/second-factor` | pending-session | `{ code }`. Wrong ⇒ 401 `INVALID_CODE`; 5th wrong ⇒ challenge void, account locked, session revoked, 423. Success ⇒ rotate the session token; state `ACTIVE` when the user has one role, else `PENDING_ROLE`; returns `{ next: 'dashboard' | 'role' }` |
| POST | `/api/v1/auth/second-factor/resend` | pending-session | at most 3; new code voids the previous one |
| POST | `/api/v1/auth/role` | pending-session (`PENDING_ROLE`) or active session | `{ roleAssignmentId }` must belong to the user ⇒ rotate token, state `ACTIVE`, event `auth.role.selected` |
| POST | `/api/v1/auth/logout` | active or pending session | revokes the session, clears the cookie |
| POST | `/api/v1/auth/reauth` | action `account.view-own` | `{ password }` ⇒ sets `reauthAt`; failures count toward the password lockout |
| POST | `/api/v1/auth/activate` | gate | `{ token, password }`. Token single-use, 24 h, stored hashed. Password ≥ 12 chars, not containing the e-mail local part |
| GET | `/api/v1/notifications` | action `notifications.view-own` | own notifications only |
| POST | `/api/v1/notifications/:id/read` | action `notifications.mark-read-own` | someone else's id ⇒ 404 |
| POST | `/api/v1/locale` | gate | `{ locale }` |
| GET | `/api/v1/admin/accounts` | action `admin.accounts.list` | |
| POST | `/api/v1/admin/accounts` | action `admin.accounts.create`, recentAuth 10 min | `{ fullName, email, phone, role, courtId?, organizationName?, requestReference }` ⇒ creates user + role assignment + activation token, sends activation e-mail through `MessagingProvider`, notification of kind `INFORMATION`, event `admin.account.created` |
| GET | `/api/v1/public/case-status` | gate | `?courtId&number&code&year` ⇒ `{ status, nextHearingAt }` and nothing else. Unknown ⇒ 404 `CASE_NOT_FOUND`. 10 lookups/5 min per client ⇒ 429 |
| GET | `/api/v1/public/hearings` | gate | `?courtId&date` ⇒ `[{ startsAt, room, chamberLabel, caseNumbers: string[] }]` — no party name, no document |
| GET | `/api/demo/outbox` | demo `demo.outbox.view` | list of outbound messages |
| POST | `/api/demo/switch-account` | demo `demo.account.switch` | `{ roleAssignmentId }` of a demo-flagged account ⇒ new `ACTIVE` session, event `demo.account.switched` (records previous and new user ids) |

Demo endpoints are served by a single catch-all `src/app/api/demo/[...path]/route.ts` that lazily imports `src/demo/server/router` and answers a plain 404 when demo tools are off, so that no demo route exists in production mode.

## 7. Pages

All pages are server components rendered dynamically (nonce-based CSP). Authenticated pages call `requirePage`.

| Route | Title (Arabic, from the study/prompt) | Access |
| --- | --- | --- |
| `/access` | رمز الولوج إلى بيئة العرض | pre-gate |
| `/` | صفحة الاستقبال | gate |
| `/track` | تتبع الملف | gate |
| `/hearings` | جدول الجلسات | gate |
| `/environment` | مكونات بيئة العرض | gate |
| `/login`, `/login/second-factor`, `/login/role` | الدخول، التحقق بالعامل الثاني، اختيار الصفة | gate / pending session |
| `/activate` | تفعيل الحساب | gate |
| `/dashboard` | لوحة البداية with the three boxes «ينتظر إجراء مني» «آجال تقترب» «جديد منذ آخر دخول» | active session |
| `/notifications` | الإشعارات | active session |
| `/account` | الحساب الشخصي (identity, roles, verification label «تم التحقق (محاكاة)», role switch, sign-out) | active session |
| `/reauth` | إعادة التحقق من الهوية | active session |
| `/admin/accounts`, `/admin/accounts/new` | الحسابات، إنشاء حساب | `SYSTEM_ADMIN` |
| `/demo/outbox` | صندوق الرسائل الصادرة | demo tools |

Top bar in Phase 0: logo slot (neutral frame, fixed size, text «موضع الشعار الرسمي») before the wordmark «منصة المحكمة الرقمية»; the single quiet indicator «بيئة العرض» linking to `/environment`; notifications bell; language switcher; account menu. The search box and the deadlines register entry of the study's five-element bar arrive in Phase 1 together with the file page and the deadlines register: no control is rendered before it has an effect.

Visual identity: wordmark in letters only; one calm institutional colour (ink blue `#1F3A4D` family) with neutrals; naskh for headings, plain sans for the interface; wide whitespace, hairline separators. No gradient, no decorative image, no playful illustration, no coloured icon, no emoji, no exclamation mark. Red is reserved for an expired time limit and orange for an approaching one. The three notification kinds (تبليغ قانوني، إخبار، تذكير) differ by label and border treatment, not by colour alone.

Accessibility: `lang`/`dir` on `<html>`, skip link, one `<h1>` per page, labelled controls, visible focus, `aria-live` on form errors, 44 px touch targets, AA contrast. Phone-first layouts.

## 8. Database (Prisma schema, one dated migration)

Tables: `Court`, `Organization`, `User`, `RoleAssignment`, `Session`, `SecondFactorChallenge`, `ActivationToken`, `AuthAttempt`, `Lockout`, `RateLimitHit`, `Event`, `OutboundMessage`, `Notification`, `PlatformClock`, `SecretSetting`, `Job`, `SystemState`, `CaseFile`, `Hearing`.

- `User`: `id`, `email` (unique, lower-cased), `fullName`, `phone`, `passwordHash` (nullable until activation), `isDemo`, `lastLoginAt`, `createdAt`.
- `RoleAssignment`: `userId`, `role`, `courtId?`, `organizationId?`, `verificationStatus` (`VERIFIED_SIMULATED` | `VERIFIED` | `UNVERIFIED`), `verificationSource`, `revokedAt?`.
- `Session`: `id`, `tokenHash` (unique), `userId`, `state`, `roleAssignmentId?`, `createdAt`, `lastSeenAt`, `absoluteExpiresAt`, `reauthAt?`, `revokedAt?`, `resendCount`.
- `Event`: `seq BIGINT PRIMARY KEY`, `id uuid unique`, `occurredAt`, `recordedAt`, `actorUserId?`, `actorRole?`, `action`, `outcome`, `caseFileId?`, `legalBasis?`, `details jsonb`, `prevHash char(64)`, `hash char(64) unique`.
  The migration adds, in raw SQL, a `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` statement trigger on `"Event"` that raise an exception. No foreign key from `Event` to mutable tables (ids are stored as plain values so nothing can cascade into the log).
- `OutboundMessage`: `channel` (`SMS` | `EMAIL`), `sender`, `recipient`, `body`, `templateKey`, `createdAt` (platform time).
- `Notification`: `userId`, `kind` (`LEGAL_NOTIFICATION` | `INFORMATION` | `REMINDER`), `templateKey`, `params jsonb`, `caseFileId?`, `targetPath?`, `createdAt`, `readAt?`.
- `PlatformClock`: single row, `offsetSeconds BIGINT >= 0` (CHECK constraint; never decreases — enforced by trigger).
- `SecretSetting`: `name` unique, `ciphertext`, `iv`, `tag`, `last4`, `keyVersion`, `updatedAt`, `updatedByUserId`.
- `Job`: `id`, `type`, `payload jsonb`, `runAt`, `status`, `attempts`, `lockedAt?`, `lockedBy?`, `lastError?` (error class only).
- `CaseFile` (minimal precursor, extended in Phase 1): `id`, `nationalRef` unique, `courtId`, `number`, `code`, `year`, `status` (`FILED`, `REGISTERED`, `RAPPORTEUR_ASSIGNED`, `IN_NOTIFICATION`, `IN_PREPARATION`, `IN_EXPERTISE`, `READY`, `IN_DELIBERATION`, `JUDGMENT_ISSUED`, `UNDER_APPEAL`, `IN_ENFORCEMENT`, `CLOSED`), `nextHearingId?`, `isDemo`. Unique `(courtId, number, code, year)`.
- `Hearing`: `courtId`, `chamberLabel`, `room`, `startsAt`.

## 9. Demo tools (`src/demo`)

Isolated module. Entry points, both lazy:

1. `src/app/api/demo/[...path]/route.ts` → `src/demo/server/router.ts`.
2. `src/components/shell/demo-slot.tsx` (server component) → `src/demo/ui/DemoBar.tsx`, rendered by the root layout only when demo mode and `DEMO_TOOLS` are on. The page `/demo/outbox` is `src/app/demo/[[...slug]]/page.tsx`, which calls `notFound()` unless enabled and then lazily renders `src/demo/ui/*`.

The bottom bar never mixes with the platform UI (fixed bottom strip, distinct neutral background, its own landmark `aria-label`). Phase 0 tools: account switcher (lists demo accounts with their role; one click) and outbox. Every use is written to the event log. The switcher refuses any account not flagged `isDemo`. The server re-checks the mode on every request.

## 10. Seed (`src/cli/seed.ts`)

Refuses to run unless `APP_MODE=demo`. `--reset` drops and recreates the schema, re-applies migrations, then seeds. Without `--reset` it is idempotent.

- Courts: «المحكمة الابتدائية التجارية النموذجية» and «محكمة الاستئناف التجارية النموذجية».
- One account per role, two lawyers (دفاع المدعية، دفاع المدعى عليهما), two bailiffs, one accounting expert, one model bank «البنك النموذجي», one model administration «الإدارة العمومية النموذجية», one user holding two roles (قاض مقرر في هيئة ورئيس هيئة أخرى). The counsellor/panel roles also exist at the appeal court.
- Every person and body is fictitious and named in the study's manner (letters): «الأستاذة دال», «الأستاذ هاء», «القاضي واو»… No real name, no real identifier. E-mails under `demo.mahkama.example`. Phones in a reserved-looking fictitious form.
- At least six `CaseFile` rows at different statuses with fictitious numbers/codes and a few `Hearing` rows, so the public pages answer. The model case itself is **not** created: it starts from zero in Phase 2.
- One `INFORMATION` notification per account announcing its creation.
- All seeded users are `isDemo = true`; `SystemState.demoDataPresent = true`.

## 11. Worker (`src/worker/main.ts`)

Same code base, other command. Runs the boot check, then: job loop; every 10 min `events.verify-chain` (result stored in `SystemState`, failure logged at error level and written as an event); every 10 min cleanup of expired sessions, challenges, activation tokens and rate-limit rows. Handles SIGTERM gracefully. No Railway cron.

## 12. Delivery files

- `Dockerfile`: multi-stage on `node:22-bookworm-slim`, `npm ci`, `prisma generate`, `next build`, worker/CLI bundle; final stage runs as a non-root user; `PORT` honoured; no secret baked in. (Headless Chromium for PDF generation is added in Phase 1 with the document service.)
- `.railway/railway.ts`: `web` and `worker` services from the GitHub repo (`build: { builder: 'DOCKERFILE' }`, `checkSuites: true` so deploys wait for CI), `preDeploy` = migrations on `web`, `healthcheck: '/healthz'`, `postgres`, `bucket` (region `ams`). Secrets are `preserve()`; database URL is a reference using the private network. Type-checked against the `railway` package.
- `.github/workflows/ci.yml`: lint, typecheck, core tests, architecture tests, integration tests (PostgreSQL service), build, e2e, `npm audit --audit-level=high`, secret scan (gitleaks), on every push and pull request.
- `.env.example`, `README.md` (local run, deployment, demo accounts, the two modes).

## 13. Definition of done for Phase 0

1. `npm run check`, `npm run test:int`, `npm run build`, `npm run test:e2e` all pass.
2. Logging in with each role shows its dashboard with the three boxes.
3. Every login and every refusal is in the event log; the log refuses UPDATE/DELETE/TRUNCATE; `npm run events:verify` passes and fails after tampering.
4. The account locks after consecutive wrong passwords and after consecutive wrong codes.
5. Every endpoint in the registry refuses a request without a session (matrix test), and every role is refused every action that is not its own.
6. `APP_MODE=production` refuses to boot.
7. No CSP violation, no inline script without nonce, on any page.
