// Static analysis helpers for the architecture tests: a file walker, a small
// lexer that blanks comments (and, for a second view, the contents of string,
// template and regular-expression literals) while keeping every offset and
// line number, and a scanner that tells whether a position is inside a
// function body or runs at module load.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { SRC_ROOT } from './env';

export interface SourceFile {
  /** absolute path */
  readonly path: string;
  /** path relative to apps/web/src, with forward slashes */
  readonly rel: string;
  readonly text: string;
  /** comments blanked, strings kept */
  readonly code: string;
  /** comments and the contents of string, template and regex literals blanked */
  readonly bare: string;
}

export function walk(dir: string, accept: (rel: string) => boolean, root = dir): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const rel = relative(root, full).split(sep).join('/');
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'generated' || name.startsWith('.')) continue;
      out.push(...walk(full, accept, root));
    } else if (accept(rel)) {
      out.push(full);
    }
  }
  return out.sort();
}

const cache = new Map<string, SourceFile>();

export function load(path: string): SourceFile {
  let file = cache.get(path);
  if (!file) {
    const text = readFileSync(path, 'utf8');
    const { code, bare } = lex(text);
    file = { path, rel: relative(SRC_ROOT, path).split(sep).join('/'), text, code, bare };
    cache.set(path, file);
  }
  return file;
}

/** Every .ts and .tsx file of apps/web/src, except the generated Prisma client. */
export function sourceFiles(filter: (rel: string) => boolean = () => true): SourceFile[] {
  return walk(SRC_ROOT, (rel) => /\.(ts|tsx)$/.test(rel) && !rel.startsWith('generated/') && filter(rel)).map(load);
}

export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

export function where(file: SourceFile, index: number): string {
  return `src/${file.rel}:${String(lineAt(file.text, index))}`;
}

/** Every match of `pattern` (global) in `view`, as "file:line: text". */
export function findAll(file: SourceFile, view: 'text' | 'code' | 'bare', pattern: RegExp): string[] {
  const out: string[] = [];
  const haystack = file[view];
  for (const match of haystack.matchAll(pattern)) {
    const index = match.index;
    const lineStart = file.text.lastIndexOf('\n', index) + 1;
    const lineEnd = file.text.indexOf('\n', index);
    const line = file.text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
    out.push(`${where(file, index)}: ${line.slice(0, 160)}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lexer

const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

function regexMayStart(prev: string, prevWord: string, next: string | undefined): boolean {
  if (next === '>' || next === '/' || next === '*') return false; // "/>" of JSX, comments
  if (prev === '') return true;
  if (/[\w$]/.test(prev)) return REGEX_AFTER_WORD.has(prevWord);
  return '(,=:[!&|?{;+-*%~^'.includes(prev);
}

export function lex(text: string): { code: string; bare: string } {
  const code = text.split('');
  const bare = text.split('');
  const blank = (arr: string[], from: number, to: number) => {
    for (let k = from; k < to && k < arr.length; k += 1) if (arr[k] !== '\n') arr[k] = ' ';
  };
  const stack: { template: boolean; depth: number }[] = [{ template: false, depth: 0 }];
  let prev = '';
  let prevWord = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const top = stack[stack.length - 1]!;
    const ch = text.charAt(i);
    if (top.template) {
      if (ch === '\\') {
        blank(bare, i, i + 2);
        i += 2;
      } else if (ch === '`') {
        stack.pop();
        prev = '`';
        i += 1;
      } else if (ch === '$' && text.charAt(i + 1) === '{') {
        stack.push({ template: false, depth: 0 });
        prev = '{';
        i += 2;
      } else {
        blank(bare, i, i + 1);
        i += 1;
      }
      continue;
    }
    const next = text.charAt(i + 1);
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(code, i, stop);
      blank(bare, i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(code, i, stop);
      blank(bare, i, stop);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && text.charAt(j) !== ch && text.charAt(j) !== '\n') j += text.charAt(j) === '\\' ? 2 : 1;
      blank(bare, i + 1, j);
      i = j + 1;
      prev = ch;
      continue;
    }
    if (ch === '`') {
      stack.push({ template: true, depth: 0 });
      i += 1;
      continue;
    }
    if (ch === '/' && regexMayStart(prev, prevWord, next)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && text.charAt(j) !== '\n') {
        const c = text.charAt(j);
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        j += 1;
      }
      blank(bare, i + 1, j);
      i = j + 1;
      while (i < n && /[a-z]/i.test(text.charAt(i))) i += 1;
      prev = '/';
      continue;
    }
    if (ch === '{') top.depth += 1;
    if (ch === '}') {
      if (top.depth === 0 && stack.length > 1) {
        stack.pop();
        prev = '}';
        i += 1;
        continue;
      }
      top.depth -= 1;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[\w$]/.test(text.charAt(j))) j += 1;
      prevWord = text.slice(i, j);
      prev = text.charAt(j - 1);
      i = j;
      continue;
    }
    if (!/\s/.test(ch)) prev = ch;
    i += 1;
  }
  return { code: code.join(''), bare: bare.join('') };
}

// ---------------------------------------------------------------------------
// Module specifiers

export interface Specifier {
  readonly value: string;
  readonly dynamic: boolean;
  /** `import type …` / `export type …`: erased at compilation */
  readonly typeOnly: boolean;
  readonly index: number;
}

/** Static imports and re-exports, dynamic import() and require() of a file (comments ignored). */
export function specifiers(file: SourceFile): Specifier[] {
  const out: Specifier[] = [];
  const code = file.code;
  const statics = /(?:^|[;\n}])\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?(['"])([^'"]+)\2/g;
  for (const m of code.matchAll(statics)) out.push({ value: m[3]!, dynamic: false, typeOnly: m[1] !== undefined, index: m.index });
  for (const m of code.matchAll(/\bimport\s*\(\s*(['"`])([^'"`]+)\1/g)) {
    out.push({ value: m[2]!, dynamic: true, typeOnly: false, index: m.index });
  }
  for (const m of code.matchAll(/\brequire\s*\(\s*(['"`])([^'"`]+)\1/g)) {
    out.push({ value: m[2]!, dynamic: false, typeOnly: false, index: m.index });
  }
  return out;
}

/** The file an internal specifier ('@/…' or relative) resolves to, or null for a package. */
export function resolveImport(from: SourceFile, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC_ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from.path), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Every file reached from `start` through static, non-type-only imports, with
 * the chain of imports that reaches it (for precise failure messages).
 */
export function reachableFrom(start: string): Map<string, string[]> {
  const chains = new Map<string, string[]>([[start, [start]]]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (!/\.(ts|tsx)$/.test(current)) continue;
    const file = load(current);
    for (const spec of specifiers(file)) {
      if (spec.dynamic || spec.typeOnly) continue;
      const target = resolveImport(file, spec.value);
      if (!target || chains.has(target)) continue;
      chains.set(target, [...(chains.get(current) ?? []), target]);
      queue.push(target);
    }
  }
  return chains;
}

/** Packages imported (statically, not type-only) by a file. */
export function packagesOf(file: SourceFile): Specifier[] {
  return specifiers(file).filter((s) => !s.dynamic && !s.typeOnly && !s.value.startsWith('.') && !s.value.startsWith('@/'));
}

// ---------------------------------------------------------------------------
// Function context

const BLOCK_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);

function prevNonSpace(s: string, from: number): number {
  let i = from;
  while (i >= 0 && /\s/.test(s.charAt(i))) i -= 1;
  return i;
}

function wordBefore(s: string, end: number): string {
  let i = end;
  while (i >= 0 && /[\w$]/.test(s.charAt(i))) i -= 1;
  return s.slice(i + 1, end + 1);
}

function matchingOpen(s: string, close: number, open: string, shut: string): number {
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    const c = s.charAt(i);
    if (c === shut) depth += 1;
    else if (c === open) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Whether the `{` at `index` opens a function body. */
function opensFunction(s: string, index: number): boolean {
  let p = prevNonSpace(s, index - 1);
  if (p < 0) return false;
  if (s.charAt(p) === '>' && s.charAt(p - 1) === '=') return true; // arrow body
  // A return-type annotation between ")" and "{": ") : Promise<void> {"
  if (s.charAt(p) !== ')') {
    const close = s.lastIndexOf(')', p);
    if (close >= 0 && /^\s*:\s*[^;{}=]*$/.test(s.slice(close + 1, index))) p = close;
  }
  if (s.charAt(p) === ')') {
    const open = matchingOpen(s, p, '(', ')');
    if (open < 0) return false;
    const before = prevNonSpace(s, open - 1);
    if (before < 0) return false;
    const c = s.charAt(before);
    if (c === '>' || c === '*') return true; // generic or generator
    if (/[\w$]/.test(c)) return !BLOCK_KEYWORDS.has(wordBefore(s, before));
    return false;
  }
  return false;
}

/**
 * Offsets of `pattern` matches that run at module load (outside every function
 * body), in the `bare` view of the file.
 */
export function topLevelMatches(file: SourceFile, pattern: RegExp): number[] {
  const s = file.bare;
  const hits = [...s.matchAll(pattern)].map((m) => m.index);
  if (hits.length === 0) return [];
  const inFunction: boolean[] = new Array<boolean>(s.length).fill(false);
  const braces: boolean[] = [];
  const arrows: number[] = []; // bracket depth at which an expression-bodied arrow began
  let bracketDepth = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charAt(i);
    if (c === '{') {
      braces.push(opensFunction(s, i));
      bracketDepth += 1;
    } else if (c === '}') {
      braces.pop();
      bracketDepth -= 1;
      while (arrows.length > 0 && arrows[arrows.length - 1]! > bracketDepth) arrows.pop();
    } else if (c === '(' || c === '[') {
      bracketDepth += 1;
    } else if (c === ')' || c === ']') {
      bracketDepth -= 1;
      while (arrows.length > 0 && arrows[arrows.length - 1]! > bracketDepth) arrows.pop();
    } else if (c === ';' || c === ',') {
      while (arrows.length > 0 && arrows[arrows.length - 1]! >= bracketDepth) arrows.pop();
    } else if (c === '>' && s.charAt(i - 1) === '=') {
      const nextIndex = s.slice(i + 1).search(/\S/);
      if (nextIndex >= 0 && s.charAt(i + 1 + nextIndex) !== '{') arrows.push(bracketDepth);
    }
    inFunction[i] = braces.includes(true) || arrows.length > 0;
  }
  return hits.filter((index) => !inFunction[index]);
}

// ---------------------------------------------------------------------------
// Default export of a page or layout

/** The first statement of the body of `export default (async) function`, and its offset. */
export function firstStatementOfDefaultExport(file: SourceFile): { statement: string; index: number } | null {
  const s = file.code;
  const head = /export\s+default\s+(?:async\s+)?function\b[^(]*\(/.exec(s);
  if (!head) return null;
  let depth = 0;
  let i = head.index + head[0].length - 1;
  for (; i < s.length; i += 1) {
    const c = s.charAt(i);
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const bodyStart = s.indexOf('{', i);
  if (bodyStart < 0) return null;
  let j = bodyStart + 1;
  while (j < s.length && /\s/.test(s.charAt(j))) j += 1;
  const end = s.indexOf(';', j);
  const statement = s.slice(j, end < 0 ? undefined : end).replace(/\s+/g, ' ').trim();
  return { statement, index: j };
}
