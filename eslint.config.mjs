// ESLint flat configuration for the whole repository.
// Besides type-aware TypeScript rules and the security plugins, it carries the
// architecture rules of docs/phases/phase-0-contract.md §2. The same rules are
// asserted again by the architecture tests (apps/web/tests/architecture).
import js from '@eslint/js';
import globals from 'globals';
import security from 'eslint-plugin-security';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import tseslint from 'typescript-eslint';

const ARABIC = '[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF]';

const systemTimeSelectors = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'Read time through the platform clock (apps/web/src/server/clock.ts).',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'Read time through the platform clock (apps/web/src/server/clock.ts).',
  },
  {
    selector: "MemberExpression[object.name='performance'][property.name='now']",
    message: 'Read time through the platform clock (apps/web/src/server/clock.ts).',
  },
  {
    selector: "MemberExpression[object.name='process'][property.name='hrtime']",
    message: 'Read time through the platform clock (apps/web/src/server/clock.ts).',
  },
];

const arabicLiteralSelectors = [
  {
    selector: `Literal[value=/${ARABIC}/]`,
    message: 'User-facing text belongs in apps/web/src/i18n/messages, not in code.',
  },
  {
    selector: `TemplateElement[value.raw=/${ARABIC}/]`,
    message: 'User-facing text belongs in apps/web/src/i18n/messages, not in code.',
  },
  {
    selector: `JSXText[value=/${ARABIC}/]`,
    message: 'User-facing text belongs in apps/web/src/i18n/messages, not in code.',
  },
];

const unsafeCodeSelectors = [
  {
    selector: "ExpressionStatement[directive='use server']",
    message: 'Server Actions are not used: every mutation goes through /api/v1 (defineEndpoint).',
  },
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'Raw HTML insertion is forbidden.',
  },
  {
    selector: "JSXAttribute[name.name='style']",
    message: 'Inline style attributes violate the content security policy; use classes.',
  },
  {
    selector: "JSXOpeningElement[name.name='script']",
    message: 'No inline script elements (content security policy).',
  },
  {
    selector: 'MemberExpression[property.name=/^\\$(queryRawUnsafe|executeRawUnsafe)$/]',
    message: 'String-built SQL is forbidden; use tagged $queryRaw/$executeRaw.',
  },
];

const dbImports = [
  { group: ['@/generated/prisma', '@/generated/prisma/*'], message: 'Only server code may use the database client.' },
  { group: ['@prisma/*', 'pg'], message: 'Only server code may use the database client.' },
  { group: ['@/server/db'], message: 'Pages and components read data through server services.' },
];

const demoImports = [
  { group: ['@/demo', '@/demo/*'], message: 'The demo module is reached only through its entry points, with import().' },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist-server/**',
      'apps/web/src/generated/**',
      'apps/web/next-env.d.ts',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      'tools/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  security.configs.recommended,
  {
    plugins: { 'no-unsanitized': noUnsanitized },
    rules: {
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
    },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Object-key access on our own closed tables is the normal pattern; the
      // rule's false positives would hide real findings.
      'security/detect-object-injection': 'off',
      'no-restricted-syntax': ['error', ...systemTimeSelectors, ...arabicLiteralSelectors, ...unsafeCodeSelectors],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Configuration and build scripts: plain Node, outside the application rules.
    files: ['**/*.config.ts', '**/*.config.mjs', 'apps/web/scripts/**', 'apps/web/vitest.shared.ts', '.railway/**'],
    rules: {
      'no-restricted-syntax': 'off',
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    // Rule 1: the core imports only node:crypto and zod.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!(zod|node:crypto)$)(?!\\.{1,2}/).+',
              message: 'packages/core imports only node:crypto and zod (contract §2 rule 1).',
            },
          ],
        },
      ],
    },
  },
  {
    // Rules 2 and 3 for everything that is not server code.
    files: ['apps/web/src/app/**/*.{ts,tsx}', 'apps/web/src/components/**/*.{ts,tsx}', 'apps/web/src/i18n/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...dbImports, ...demoImports] }],
    },
  },
  {
    // Rule 3 for server code: no static import of the demo module.
    files: ['apps/web/src/server/**/*.ts', 'apps/web/src/worker/**/*.ts', 'apps/web/src/cli/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: demoImports,
          paths: [
            { name: 'node:http', message: 'Outbound connections only from src/server/outbound.' },
            { name: 'node:https', message: 'Outbound connections only from src/server/outbound.' },
            { name: 'node:net', message: 'Outbound connections only from src/server/outbound.' },
            { name: 'undici', message: 'Outbound connections only from src/server/outbound.' },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/server/**/*.ts'],
    ignores: ['apps/web/src/server/outbound/**'],
    rules: {
      'no-restricted-globals': ['error', { name: 'fetch', message: 'Outbound connections only from src/server/outbound.' }],
    },
  },
  {
    // The clock service is the only place allowed to read system time.
    files: ['apps/web/src/server/clock.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...arabicLiteralSelectors, ...unsafeCodeSelectors],
    },
  },
  {
    // Seed data is fictitious demo content written in Arabic.
    files: ['apps/web/src/cli/seed-data/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...systemTimeSelectors, ...unsafeCodeSelectors],
    },
  },
  {
    // Tests may read time and hold Arabic fixtures.
    files: ['**/tests/**/*.{ts,tsx}', '**/test/**/*.ts', '**/*.test.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...unsafeCodeSelectors],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-regexp': 'off',
    },
  },
);
