// Reads the tables of the plain-language rule cases (packages/core/rules-tests/*.md)
// and the rule tables themselves (rules/*.json at the repository root).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CORE = join(import.meta.dirname, '..', '..');
export const RULES_DIR = join(CORE, '..', '..', 'rules');

/** The tables of a Markdown file, by the title of the section that holds them. */
export function tablesOf(file: string): Map<string, string[][]> {
  const tables = new Map<string, string[][]>();
  let section = '';
  for (const line of readFileSync(join(CORE, 'rules-tests', file), 'utf8').split('\n')) {
    if (/^#{1,3} /.test(line)) section = line.replace(/^#+ /, '').trim();
    if (!line.startsWith('|') || line.startsWith('| ---')) continue;
    const cells = line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
    const rows = tables.get(section) ?? [];
    rows.push(cells);
    tables.set(section, rows);
  }
  // Drop the header row of each table.
  for (const [key, rows] of tables) tables.set(key, rows.slice(1));
  return tables;
}

export function rows(file: string, section: string): string[][] {
  const found = tablesOf(file).get(section);
  if (!found || found.length === 0) throw new Error(`${file}: no table under «${section}»`);
  return found;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the shape of the rule file
export function readRules<T>(name: string): T {
  return JSON.parse(readFileSync(join(RULES_DIR, name), 'utf8')) as T;
}

export const yes = (cell: string | undefined) => cell === 'نعم';
