// Contract §2 rule 6: every src/app/**/route.ts and route.demo.ts export is a
// defineEndpoint product registered in src/server/http/registry.ts, and the
// registry has no entry without a file (and the method it names).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC_ROOT } from '../helpers/env';
import { loadEndpoints, routePattern } from '../helpers/http';
import { load, walk, where, type SourceFile } from '../helpers/source';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const ROUTE_SEGMENT_CONFIG = new Set(['dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime', 'preferredRegion', 'maxDuration']);

const routeFiles = walk(join(SRC_ROOT, 'app'), (rel) => /(^|\/)route(\.demo)?\.ts$/.test(rel)).map(load);
const ENDPOINTS = await loadEndpoints();

const moduleOf = (file: SourceFile) => `@/${file.rel.replace(/\.ts$/, '')}`;

interface Export {
  readonly name: string;
  readonly index: number;
  /** `export const NAME = defineEndpoint(` */
  readonly wrapped: boolean;
  readonly literal?: { id?: string; method?: string; path?: string };
}

/** Whether `name` is a function of the file whose body is `defineEndpoint(...)`. */
function returnsDefineEndpoint(code: string, name: string): boolean {
  const arrow = new RegExp(`\\b(?:const|let)\\s+${name}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*(?::[^=]+)?=>\\s*\\(?\\s*defineEndpoint\\s*\\(`);
  const declaration = new RegExp(`\\bfunction\\s+${name}\\s*\\([^)]*\\)[^{]*\\{\\s*return\\s+defineEndpoint\\s*\\(`);
  return arrow.test(code) || declaration.test(code);
}

function exportsOf(file: SourceFile): { exports: Export[]; problems: string[] } {
  const exports: Export[] = [];
  const problems: string[] = [];
  const code = file.code;
  for (const m of code.matchAll(/\bexport\s+(?:declare\s+)?(const|let|var|function|async\s+function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    const name = m[2]!;
    const rest = code.slice(m.index);
    const direct = m[1] === 'const' && new RegExp(`^export\\s+const\\s+${name}\\s*(?::[^=]+)?=\\s*defineEndpoint\\s*\\(`).test(rest);
    // Or a factory of the same file whose body is a defineEndpoint call.
    const factory = m[1] === 'const' ? new RegExp(`^export\\s+const\\s+${name}\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*\\(`).exec(rest)?.[1] : undefined;
    const wrapped = direct || (factory !== undefined && returnsDefineEndpoint(code, factory));
    let literal: Export['literal'];
    if (wrapped) {
      const spec = rest.slice(0, 600);
      const pick = (key: string) => new RegExp(`\\b${key}\\s*:\\s*(['"])([^'"]+)\\1`).exec(spec)?.[2];
      literal = {};
      const id = pick('id');
      const method = pick('method');
      const path = pick('path');
      if (id) literal.id = id;
      if (method) literal.method = method;
      if (path) literal.path = path;
    }
    exports.push(literal ? { name, index: m.index, wrapped, literal } : { name, index: m.index, wrapped });
  }
  for (const m of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) exports.push({ name, index: m.index, wrapped: false });
    }
  }
  for (const m of code.matchAll(/\bexport\s+default\b/g)) problems.push(`${where(file, m.index)}: a route file has no default export`);
  for (const m of code.matchAll(/\bexport\s*\*\s*from\b/g)) problems.push(`${where(file, m.index)}: no re-export of a whole module`);
  return { exports, problems };
}

describe('route files and the endpoint registry (contract §2 rule 6)', () => {
  it('the application has route files', () => {
    expect(routeFiles.length).toBeGreaterThan(10);
  });

  for (const file of routeFiles) {
    it(`src/${file.rel} exports only defineEndpoint products (and segment configuration)`, () => {
      const { exports, problems } = exportsOf(file);
      for (const e of exports) {
        if (METHODS.has(e.name)) {
          if (!e.wrapped) problems.push(`${where(file, e.index)}: export ${e.name} must be \`export const ${e.name} = defineEndpoint({...})\``);
        } else if (!ROUTE_SEGMENT_CONFIG.has(e.name)) {
          problems.push(`${where(file, e.index)}: unexpected export ${e.name} in a route file`);
        }
      }
      if (!exports.some((e) => METHODS.has(e.name))) problems.push(`src/${file.rel}: exports no HTTP method`);
      expect(problems).toEqual([]);
    });

    it(`src/${file.rel}: every exported method is listed in ENDPOINTS with the same id, method and path`, () => {
      const problems: string[] = [];
      for (const e of exportsOf(file).exports.filter((x) => METHODS.has(x.name))) {
        const entry = ENDPOINTS.find((x) => x.module === moduleOf(file) && x.method === e.name);
        if (!entry) {
          problems.push(`${where(file, e.index)}: ${e.name} is not in ENDPOINTS (module ${moduleOf(file)})`);
          continue;
        }
        if (e.literal?.method && e.literal.method !== e.name) problems.push(`${where(file, e.index)}: declares method ${e.literal.method} for export ${e.name}`);
        if (e.literal?.id && e.literal.id !== entry.id) problems.push(`${where(file, e.index)}: id ${e.literal.id} differs from the registry (${entry.id})`);
        if (e.literal?.path && e.literal.path !== entry.path) problems.push(`${where(file, e.index)}: path ${e.literal.path} differs from the registry (${entry.path})`);
      }
      expect(problems).toEqual([]);
    });
  }

  it('every ENDPOINTS entry names an existing route file that exports its method', () => {
    const problems: string[] = [];
    for (const entry of ENDPOINTS) {
      const file = join(SRC_ROOT, `${entry.module.replace(/^@\//, '')}.ts`);
      if (!entry.module.startsWith('@/app/') || !existsSync(file)) {
        problems.push(`${entry.id}: module ${entry.module} does not exist`);
        continue;
      }
      const exported = exportsOf(load(file)).exports.find((e) => e.name === entry.method);
      if (!exported?.wrapped) problems.push(`${entry.id}: ${entry.module} does not export ${entry.method} = defineEndpoint(...)`);
    }
    expect(problems).toEqual([]);
  });

  it('every ENDPOINTS path matches the location of its route file', () => {
    const problems = ENDPOINTS.filter((e) => routePattern(e.module) !== e.path).map(
      (e) => `${e.id}: path ${e.path}, but ${e.module} serves ${routePattern(e.module)}`,
    );
    expect(problems).toEqual([]);
  });

  it('demo endpoints live in route.demo.ts files only, and route.demo.ts files hold demo endpoints only', () => {
    const problems: string[] = [];
    for (const entry of ENDPOINTS) {
      const demoFile = entry.module.endsWith('.demo');
      if (demoFile !== (entry.access.kind === 'demo')) problems.push(`${entry.id}: access ${entry.access.kind} in ${entry.module}`);
    }
    expect(problems).toEqual([]);
  });
});
