// Contract §2 rule 7 and §7: every page.tsx / page.demo.tsx, and every
// layout.tsx under (gate) and (app), calls exactly one page guard
// (requireGate, requirePending, requirePage, requireDemo) as the first
// statement of its default export, and every page is listed in
// src/server/http/page-registry.ts with the guard it calls. The registry
// equals the page list of contract §7 (tests/helpers/pages.ts).
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC_ROOT } from '../helpers/env';
import { routeSegments } from '../helpers/http';
import { EXPECTED_PAGES } from '../helpers/pages';
import { findAll, firstStatementOfDefaultExport, load, reachableFrom, walk, where, type SourceFile } from '../helpers/source';

interface PageEntry {
  readonly id: string;
  readonly path: string;
  readonly guard: 'none' | 'gate' | 'pending' | 'page' | 'demo';
  readonly action?: string;
  readonly file?: string;
}

const mod = (await import('@/server/http/page-registry')) as unknown as { PAGES?: readonly PageEntry[] };
const PAGES: readonly PageEntry[] = mod.PAGES ?? [];

const GUARD_OF = { requireGate: 'gate', requirePending: 'pending', requirePage: 'page', requireDemo: 'demo' } as const;
const GUARD_CALL = /\b(requireGate|requirePending|requirePage|requireDemo)\s*\(/g;
const FIRST_STATEMENT = /^(?:(?:const|let)\s+[^=]+=\s*)?(?:await\s+)?(requireGate|requirePending|requirePage|requireDemo)\s*\(([^)]*)/;

const appDir = join(SRC_ROOT, 'app');
const pageFiles = walk(appDir, (rel) => /(^|\/)page(\.demo)?\.tsx?$/.test(rel)).map(load);
const guardedLayouts = walk(appDir, (rel) => /(^|\/)\((gate|app)\)\//.test(rel) && /(^|\/)layout\.tsx?$/.test(rel)).map(load);

/** The route pattern of a page file: '/login/confirm', '/demo/:slug*'. */
function pagePattern(file: SourceFile): string {
  const parts = routeSegments(`@/${file.rel}`).map((s) => (s.kind === 0 ? s.name : s.kind === 1 ? `:${s.name}` : `:${s.name}*`));
  return `/${parts.join('/')}`;
}

function matchesPattern(pattern: string, path: string): boolean {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  for (let i = 0; i < a.length; i += 1) {
    const seg = a[i]!;
    if (seg.endsWith('*')) return seg.startsWith(':') && (b.length > i || seg === a[a.length - 1]);
    if (b[i] === undefined) return false;
    if (!seg.startsWith(':') && seg !== b[i]) return false;
  }
  return a.length === b.length;
}

function entryFor(file: SourceFile): PageEntry | undefined {
  const relToApp = file.rel.replace(/^app\//, '');
  return PAGES.find((p) => p.file === relToApp) ?? PAGES.find((p) => !p.file && matchesPattern(pagePattern(file), p.path));
}

/** The string literals passed to the guard call (an action code, a page id, a session state). */
function literalArguments(args: string): string[] {
  return [...args.matchAll(/(['"])([^'"]*)\1/g)].map((m) => m[2]!);
}

function guardProblems(file: SourceFile): { problems: string[]; guard: string | null; args: string[] } {
  const problems: string[] = [];
  const calls = findAll(file, 'bare', GUARD_CALL);
  if (calls.length !== 1) problems.push(`src/${file.rel}: ${String(calls.length)} page-guard calls (exactly one required)${calls.length ? `\n  ${calls.join('\n  ')}` : ''}`);
  const first = firstStatementOfDefaultExport(file);
  if (!first) {
    problems.push(`src/${file.rel}: no \`export default (async) function\` found`);
    return { problems, guard: null, args: [] };
  }
  const match = FIRST_STATEMENT.exec(first.statement);
  if (!match) {
    problems.push(`${where(file, first.index)}: the first statement must call a page guard, found \`${first.statement.slice(0, 120)}\``);
    return { problems, guard: null, args: [] };
  }
  return { problems, guard: GUARD_OF[match[1] as keyof typeof GUARD_OF], args: literalArguments(match[2] ?? '') };
}

describe('page guards and the page registry (contract §2 rule 7, §7)', () => {
  it('the registry lists exactly the pages of contract §7, with an allowed guard and action', () => {
    expect(PAGES.map((p) => p.path).sort()).toEqual(EXPECTED_PAGES.map((p) => p.path).sort());
    const problems: string[] = [];
    for (const expected of EXPECTED_PAGES) {
      const entry = PAGES.find((p) => p.path === expected.path);
      if (!entry) continue;
      if (!expected.guards.includes(entry.guard)) problems.push(`${entry.path}: guard ${entry.guard}, expected ${expected.guards.join(' or ')}`);
      if (expected.actions.length > 0 && entry.guard !== 'pending' && !expected.actions.includes(entry.action ?? '')) {
        problems.push(`${entry.path}: action ${entry.action ?? '(none)'}, expected ${expected.actions.join(' or ')}`);
      }
      if (expected.actions.length === 0 && entry.action) problems.push(`${entry.path}: unexpected action ${entry.action}`);
    }
    expect(problems).toEqual([]);
  });

  it('the application has its pages', () => {
    expect(pageFiles.length).toBeGreaterThanOrEqual(EXPECTED_PAGES.length);
  });

  it('every page lives in the (pre-gate), (gate) or (app) route group', () => {
    const outside = pageFiles.filter((f) => !/^app\/\((pre-gate|gate|app)\)\//.test(f.rel)).map((f) => `src/${f.rel}`);
    expect(outside).toEqual([]);
  });

  it('every registry entry names an existing page file', () => {
    const problems: string[] = [];
    for (const entry of PAGES) {
      if (entry.file) {
        if (!existsSync(join(appDir, entry.file))) problems.push(`${entry.id}: file src/app/${entry.file} does not exist`);
      } else if (!pageFiles.some((f) => matchesPattern(pagePattern(f), entry.path))) {
        problems.push(`${entry.id}: no page file serves ${entry.path}`);
      }
    }
    expect(problems).toEqual([]);
  });

  for (const file of pageFiles) {
    it(`src/${file.rel} is listed in the registry and calls its guard first`, () => {
      const entry = entryFor(file);
      expect(entry, `src/${file.rel} (${pagePattern(file)}) is not listed in PAGES`).toBeDefined();
      if (!entry) return;
      if (entry.guard === 'none') {
        expect(findAll(file, 'bare', GUARD_CALL), `src/${file.rel} is pre-gate: it calls no guard`).toEqual([]);
        expect(file.rel, 'only the visitor passphrase page has no guard').toMatch(/^app\/\(pre-gate\)\//);
        return;
      }
      const { problems, guard, args } = guardProblems(file);
      if (guard && guard !== entry.guard) problems.push(`src/${file.rel}: calls the ${guard} guard, the registry says ${entry.guard}`);
      if (guard && (entry.guard === 'page' || entry.guard === 'demo') && !args.includes(entry.action ?? '')) {
        problems.push(`src/${file.rel}: the guard is not called with the registry action ${entry.action ?? '(none)'} (arguments: ${args.join(', ')})`);
      }
      expect(problems).toEqual([]);
    });
  }

  for (const file of guardedLayouts) {
    it(`src/${file.rel} calls exactly one page guard as its first statement`, () => {
      expect(guardProblems(file).problems).toEqual([]);
    });
  }

  it('nothing under (pre-gate) renders the demo slot or reaches the demo module (contract §7, §9)', () => {
    const problems: string[] = [];
    const preGate = walk(appDir, (rel) => rel.startsWith('(pre-gate)/') && /\.(ts|tsx)$/.test(rel)).map(load);
    for (const file of preGate) {
      for (const [reached, chain] of reachableFrom(file.path)) {
        const rel = relative(SRC_ROOT, reached).split(sep).join('/');
        if (/^components\/shell\/demo-slot\.tsx?$/.test(rel) || rel.startsWith('demo/')) {
          problems.push(`src/${file.rel} reaches src/${rel} through ${chain.map((c) => relative(SRC_ROOT, c)).join(' -> ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('the (gate) and (app) layouts render the demo slot', () => {
    for (const group of ['(gate)', '(app)']) {
      const layout = [join(appDir, group, 'layout.tsx'), join(appDir, group, 'layout.ts')].find((p) => existsSync(p));
      expect(layout, `src/app/${group}/layout.tsx`).toBeDefined();
      if (!layout) continue;
      const reached = [...reachableFrom(layout).keys()].map((p) => relative(SRC_ROOT, p).split(sep).join('/'));
      expect(reached.some((r) => /^components\/shell\/demo-slot\.tsx?$/.test(r)), `${group} layout renders the demo slot`).toBe(true);
    }
  });
});
