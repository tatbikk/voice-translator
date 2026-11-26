// Independent review IR-10 (decision 73), structural part: what the core's
// declarative table says an act does is applied in one place, the applier
// (src/server/cases/effects.ts). Checked on the source tree:
//   - the executors of the procedural acts are registered only through the
//     applier's registry (actExecutors), in one module, and an executor is
//     run only by the applier, which applies the declaration after it;
//   - nothing else in src/server writes what a declaration declares: the
//     status of a file, its stored facts, the moment of its stamp, or a time
//     limit (the demo seeder in src/cli writes the demo history apart);
//   - review of the fix: nor writes a file with fields built elsewhere, which
//     the detector could not read (arguments or a data object that is not
//     written out where it is called, or that spreads such a value).
import { describe, expect, it } from 'vitest';
import { findAll, sourceFiles, where, type SourceFile } from '../helpers/source';

const APPLIER = 'server/cases/effects.ts';
const server = sourceFiles((rel) => rel.startsWith('server/'));
const all = sourceFiles();

/** The text between the parenthesis or brace at `open` and its match, in the string-free view. */
function balanced(text: string, open: number): string {
  const pair: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const stack: string[] = [];
  for (let i = open; i < text.length; i += 1) {
    const c = text[i]!;
    if (c in pair) stack.push(pair[c]!);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

/** What a `caseFile.update(...)` or `caseFile.updateMany(...)` call writes: its `data` object. */
function caseFileWrites(file: SourceFile): { at: string; data: string }[] {
  const out: { at: string; data: string }[] = [];
  for (const match of file.bare.matchAll(/\bcaseFile\s*\.\s*(?:update|updateMany|upsert)\s*\(/g)) {
    const args = balanced(file.bare, match.index + match[0].length - 1);
    const data = /\bdata\s*:\s*\{/.exec(args);
    if (data) out.push({ at: where(file, match.index), data: balanced(args, data.index + data[0].length - 1) });
  }
  return out;
}

/**
 * The `caseFile.update(...)` calls whose writes cannot be read from the source
 * (review of the IR-10 fix): arguments that are not an object literal, a `data`
 * that is not one (`data`, `data: next`), or a `data` literal that spreads a
 * value built elsewhere (`...fields`). Only the applier may write so.
 */
function opaqueCaseFileWrites(file: SourceFile): string[] {
  const out: string[] = [];
  for (const match of file.bare.matchAll(/\bcaseFile\s*\.\s*(?:update|updateMany|upsert)\s*\(/g)) {
    const at = where(file, match.index);
    const args = balanced(file.bare, match.index + match[0].length - 1).slice(1, -1).trim();
    if (!args.startsWith('{')) {
      out.push(`${at}: arguments built elsewhere`);
      continue;
    }
    const inline = /\bdata\s*:\s*\{/.exec(args);
    if (!inline) {
      out.push(`${at}: data built elsewhere`);
      continue;
    }
    const data = balanced(args, inline.index + inline[0].length - 1);
    if (/\.\.\.\s*[A-Za-z_$][\w$.]*\s*[,}(]/.test(data)) out.push(`${at}: data spreads a value built elsewhere`);
  }
  return out;
}

describe('the declarations of the procedure are applied in one place (independent review IR-10)', () => {
  it('finds the applier and the executors', () => {
    expect(server.map((f) => f.rel)).toContain(APPLIER);
    expect(server.map((f) => f.rel)).toContain('server/cases/executors.ts');
  });

  it('registers the executors of the acts only through the applier’s registry, in one module', () => {
    const calls = all
      .filter((f) => f.rel !== APPLIER)
      .flatMap((f) => findAll(f, 'bare', /\bactExecutors\s*\(/g));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^src\/server\/cases\/executors\.ts:/);
    // No other module declares an executor of an act.
    const declarers = all.filter((f) => f.rel !== APPLIER && f.rel !== 'server/cases/executors.ts').flatMap((f) => findAll(f, 'bare', /\bActExecutor\b/g));
    expect(declarers).toEqual([]);
  });

  it('runs an executor only from the applier, which applies the declaration after it', () => {
    const runs = server.filter((f) => f.rel !== APPLIER).flatMap((f) => findAll(f, 'bare', /\.\s*run\s*\(/g));
    expect(runs).toEqual([]);
  });

  it('leaves to the applier alone the status of a file, its stored facts and the moment of its stamp', () => {
    const hits: string[] = [];
    for (const file of server.filter((f) => f.rel !== APPLIER)) {
      for (const write of caseFileWrites(file)) {
        const field = /\b(status|facts|registrationStampedAt)\s*:/.exec(write.data);
        if (field) hits.push(`${write.at}: writes ${field[1]!}`);
      }
      hits.push(...findAll(file, 'code', /UPDATE\s+"CaseFile"\s+SET[^`;]*?(?:\bstatus\b|\bfacts\b|"registrationStampedAt")/g));
    }
    expect(hits).toEqual([]);
  });

  it('writes a file only with a data object written out where it is called, outside the applier (review of the fix)', () => {
    const hits = server.filter((f) => f.rel !== APPLIER).flatMap(opaqueCaseFileWrites);
    expect(hits).toEqual([]);
  });

  it('leaves to the applier alone the time limits of a file', () => {
    const hits = server
      .filter((f) => f.rel !== APPLIER)
      .flatMap((f) => [
        ...findAll(f, 'bare', /\btimeLimit\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g),
        ...findAll(f, 'code', /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"TimeLimit"/g),
      ]);
    expect(hits).toEqual([]);
  });

  it('detects a write it forbids (the detector itself)', () => {
    const sample = { path: 'x', rel: 'server/x.ts', text: '', code: '', bare: 'await tx.caseFile.update({ where: { id }, data: { status: next, x: { y: 1 } } });' } as SourceFile;
    expect(caseFileWrites({ ...sample, text: sample.bare })).toEqual([{ at: 'src/server/x.ts:1', data: '{ status: next, x: { y: 1 } }' }]);
    expect(opaqueCaseFileWrites({ ...sample, text: sample.bare })).toEqual([]);
  });

  it('detects a write whose fields are built elsewhere (the detector itself)', () => {
    const of = (bare: string) => opaqueCaseFileWrites({ path: 'x', rel: 'server/x.ts', text: bare, code: bare, bare } as SourceFile);
    expect(of('await tx.caseFile.update({ where: { id }, data });')).toEqual(['src/server/x.ts:1: data built elsewhere']);
    expect(of('await tx.caseFile.update({ where: { id }, data: next });')).toEqual(['src/server/x.ts:1: data built elsewhere']);
    expect(of('await tx.caseFile.update(args);')).toEqual(['src/server/x.ts:1: arguments built elsewhere']);
    expect(of('await tx.caseFile.updateMany({ where: { id }, data: { ...fields, code: 1 } });')).toEqual(['src/server/x.ts:1: data spreads a value built elsewhere']);
    expect(of('await tx.caseFile.update({ where: { id }, data: { a: 1, ...rest } });')).toEqual(['src/server/x.ts:1: data spreads a value built elsewhere']);
    expect(of('await tx.caseFile.update({ where: { id }, data: { ...pick(x) } });')).toEqual(['src/server/x.ts:1: data spreads a value built elsewhere']);
    // A spread of a literal written out where it is called stays readable.
    expect(of('await tx.caseFile.update({ where: { id }, data: { ...(flag ? { referredToProsecutionAt: now } : {}) } });')).toEqual([]);
  });
});
