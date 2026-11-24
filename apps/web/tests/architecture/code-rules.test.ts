// The architecture rules of contract §2, checked on the source tree with
// regular expressions over a comment-free (and, where it matters, string-free)
// view of each file. Each failure names the file and the line.
//   rule 2  only src/server, src/worker and src/cli use the database client;
//           src/proxy.ts never reaches the database
//   rule 3  nothing outside src/demo imports src/demo, except the demo entry
//           points, and only through import()
//   rule 4  system time only in src/server/clock.ts; systemNow() only from its allow-list
//   rule 5  no Arabic (or Tifinagh) letter outside src/i18n/messages and src/cli/seed-data
//   rule 8  no 'use server', no $queryRawUnsafe / $executeRawUnsafe / Prisma.raw
//   rule 9  no fetch, node:http(s), node:net, undici in src/server outside src/server/outbound
//   rule 10 no style= attribute, <script> or dangerouslySetInnerHTML in JSX
//   rule 11 no process.env read and no connection opened at module top level in src/server
//   rule 1  no decision by role outside the core: no role compared with a role code (review A-04)
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC_ROOT } from '../helpers/env';
import { findAll, lex, load, packagesOf, reachableFrom, resolveImport, sourceFiles, specifiers, topLevelMatches, where } from '../helpers/source';

const all = sourceFiles();
const relOf = (path: string) => relative(SRC_ROOT, path).split(sep).join('/');

describe('architecture rules of contract §2', () => {
  it('finds the source tree', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it("rule 8: no 'use server' directive anywhere (no Server Actions)", () => {
    const hits = all.flatMap((f) => findAll(f, 'code', /(['"])use server\1/g));
    expect(hits).toEqual([]);
  });

  it('rule 8: no $queryRawUnsafe, $executeRawUnsafe or Prisma.raw', () => {
    const hits = all.flatMap((f) => findAll(f, 'bare', /\$(?:queryRawUnsafe|executeRawUnsafe)\b|\bPrisma\s*\.\s*raw\s*\(/g));
    expect(hits).toEqual([]);
  });

  it('rule 9: no outbound network module or fetch in src/server outside src/server/outbound', () => {
    const NETWORK = /^(?:node:)?(?:http|https|http2|net|tls|dgram)$|^undici(?:\/|$)/;
    const hits: string[] = [];
    for (const file of all.filter((f) => f.rel.startsWith('server/') && !f.rel.startsWith('server/outbound/'))) {
      for (const spec of specifiers(file)) {
        if (NETWORK.test(spec.value)) hits.push(`${where(file, spec.index)}: imports ${spec.value}`);
      }
      hits.push(
        ...findAll(file, 'bare', /(?<![\w$.])fetch\s*\(|\b(?:globalThis|window|self)\s*\.\s*fetch\b|\bnew\s+(?:WebSocket|EventSource|XMLHttpRequest)\b/g),
      );
    }
    expect(hits).toEqual([]);
  });

  it('rule 5: no Arabic or Tifinagh literal (string, template or JSX text) in .ts/.tsx outside src/i18n/messages and src/cli/seed-data', () => {
    // Literals only, as contract §2 rule 5 and the ESLint rule state: English
    // comments may quote the Arabic name of a screen.
    const LETTERS = /[\p{Script=Arabic}\p{Script=Tifinagh}]+/gu;
    const hits = all
      .filter((f) => !f.rel.startsWith('i18n/messages/') && !f.rel.startsWith('cli/seed-data/'))
      .flatMap((f) => findAll(f, 'code', LETTERS));
    expect(hits).toEqual([]);
  });

  it('rule 4: system time is read only in src/server/clock.ts', () => {
    const SYSTEM_TIME =
      /\bnew\s+Date\s*\(\s*\)|\bnew\s+Date\b(?!\s*\()|(?<![\w$.])(?<!new\s+)Date\s*\(\s*\)|\bDate\s*\.\s*now\s*\(|\bperformance\s*\.\s*now\s*\(|\bprocess\s*\.\s*hrtime\b/g;
    const hits = all.filter((f) => f.rel !== 'server/clock.ts').flatMap((f) => findAll(f, 'bare', SYSTEM_TIME));
    expect(hits).toEqual([]);
  });

  it('rule 4: systemNow() is used only from src/server/auth, src/server/security, src/server/signature/service.ts, src/server/jobs/queue.ts, src/server/log.ts', () => {
    const allowed = (rel: string) =>
      rel.startsWith('server/auth/') ||
      rel.startsWith('server/security/') ||
      // the signing secret locks on real time, like the password (decision 39)
      rel === 'server/signature/service.ts' ||
      rel === 'server/jobs/queue.ts' ||
      rel === 'server/log.ts' ||
      rel === 'server/clock.ts';
    const hits = all.filter((f) => !allowed(f.rel)).flatMap((f) => findAll(f, 'bare', /\bsystemNow\b/g));
    expect(hits).toEqual([]);
  });

  it('rule 1: no role is compared with a role code outside the core (review A-04)', () => {
    const ROLE_DECISION =
      /\brole\s*(?:===|!==|==|!=)\s*['"`][A-Z_]+['"`]|['"`][A-Z_]+['"`]\s*(?:===|!==|==|!=)\s*[\w.?]*\brole\b|\.includes\(\s*[\w.?]*\.role\s*\)|case\s+['"`](?:SYSTEM_ADMIN|LAWYER|LITIGANT|EXPERT|BAILIFF|[A-Z]+_(?:CLERK|JUDGE|PRESIDENT|RAPPORTEUR))['"`]\s*:/g;
    const hits = all.flatMap((f) => findAll(f, 'code', ROLE_DECISION));
    expect(hits).toEqual([]);
  });

  it('rule 10: no style= attribute, no <script> element and no dangerouslySetInnerHTML in JSX', () => {
    const hits = all
      .filter((f) => f.rel.endsWith('.tsx'))
      .flatMap((f) => [
        ...findAll(f, 'bare', /<[A-Za-z][\w.]*\b[^<>]*?(?<![\w$.-])style\s*=/g),
        ...findAll(f, 'bare', /<script\b/gi),
        ...findAll(f, 'bare', /\bdangerouslySetInnerHTML\b/g),
      ]);
    expect(hits).toEqual([]);
  });

  it('rule 3: nothing outside src/demo imports src/demo statically; dynamic imports only from the demo entry points', () => {
    const isEntryPoint = (rel: string) =>
      (rel.startsWith('app/') && /\.demo\.tsx?$/.test(rel)) || rel === 'components/shell/demo-slot.tsx';
    const hits: string[] = [];
    for (const file of all.filter((f) => !f.rel.startsWith('demo/'))) {
      for (const spec of specifiers(file)) {
        if (spec.typeOnly) continue;
        const target = resolveImport(file, spec.value);
        const intoDemo = spec.value === '@/demo' || spec.value.startsWith('@/demo/') || (target !== null && relOf(target).startsWith('demo/'));
        if (!intoDemo) continue;
        if (!spec.dynamic) hits.push(`${where(file, spec.index)}: static import of ${spec.value}`);
        else if (!isEntryPoint(file.rel)) hits.push(`${where(file, spec.index)}: import(${spec.value}) outside the demo entry points`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('rule 2: only src/server, src/worker and src/cli import the database client', () => {
    const DATABASE = /^(?:@\/generated\/prisma(?:\/|$)|@prisma\/|pg$)/;
    const UI = (rel: string) => rel.startsWith('app/') || rel.startsWith('components/') || rel.startsWith('i18n/') || rel === 'proxy.ts';
    const hits: string[] = [];
    for (const file of all.filter((f) => !/^(server|worker|cli)\//.test(f.rel))) {
      for (const spec of specifiers(file)) {
        if (spec.typeOnly) continue;
        const target = resolveImport(file, spec.value);
        const generated = target !== null && relOf(target).startsWith('generated/prisma');
        if (DATABASE.test(spec.value) || generated) hits.push(`${where(file, spec.index)}: imports ${spec.value}`);
        if (UI(file.rel) && (spec.value === '@/server/db' || (target !== null && relOf(target) === 'server/db.ts'))) {
          hits.push(`${where(file, spec.index)}: pages and components read data through services, not ${spec.value}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('rule 2: src/proxy.ts never reaches the database, even through other modules', () => {
    const proxy = join(SRC_ROOT, 'proxy.ts');
    const hits: string[] = [];
    for (const [path, chain] of reachableFrom(proxy)) {
      const rel = relOf(path);
      const touches =
        rel === 'server/db.ts' ||
        rel.startsWith('generated/prisma') ||
        (/\.(ts|tsx)$/.test(path) && packagesOf(load(path)).some((s) => /^(?:@prisma\/|pg$)/.test(s.value)));
      if (touches) hits.push(`src/proxy.ts reaches src/${rel} through ${chain.map(relOf).join(' -> ')}`);
    }
    expect(hits).toEqual([]);
  });

  it('rule 11: nothing in src/server reads process.env or opens a connection at module top level', () => {
    const hits: string[] = [];
    for (const file of all.filter((f) => f.rel.startsWith('server/'))) {
      for (const index of topLevelMatches(file, /\bprocess\s*\.\s*env\b/g)) hits.push(`${where(file, index)}: process.env read at module load`);
      for (const index of topLevelMatches(file, /\bnew\s+(?:PrismaClient|Pool|pg\s*\.\s*Pool|pg\s*\.\s*Client)\s*\(|\.\s*\$connect\s*\(/g)) {
        hits.push(`${where(file, index)}: connection opened at module load`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('rule 11: the detector of top-level code tells module load from function bodies', () => {
    const sample = [
      'const a = process.env.A;',
      'export function f(): string { return process.env.B ?? ""; }',
      'export const g = () => process.env.C;',
      'export const h = async (x: number): Promise<void> => { void process.env.D; };',
      'const o = { k: process.env.E };',
      'if (true) { process.env.F; }',
      'class K { m() { return process.env.G; } }',
    ].join('\n');
    const { code, bare } = lex(sample);
    const file = { path: '/virtual.ts', rel: 'server/virtual.ts', text: sample, code, bare };
    const lines = topLevelMatches(file, /\bprocess\.env\b/g).map((i) => sample.slice(0, i).split('\n').length);
    expect(lines).toEqual([1, 5, 6]);
  });
});
