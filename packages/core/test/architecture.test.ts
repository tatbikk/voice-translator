// The core knows neither the web nor the database (contract §2 rule 1).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = join(import.meta.dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [],
  );
}

const IMPORT = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

describe('core package boundaries', () => {
  const files = sourceFiles(srcDir);

  it('has source files', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(`${file.slice(srcDir.length + 1)} imports only node:crypto, zod and its own modules`, () => {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(IMPORT)) {
        const specifier = match[1] ?? match[2] ?? match[3] ?? '';
        const ownModule = specifier.startsWith('.') && resolve(dirname(file), specifier).startsWith(srcDir);
        const allowed = specifier === 'node:crypto' || specifier === 'zod' || ownModule;
        expect(allowed, `${file}: ${specifier}`).toBe(true);
      }
    });

    it(`${file.slice(srcDir.length + 1)} does not read the system clock or the environment`, () => {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/Date\.now\(|new Date\(\)|performance\.now|process\.env|process\.hrtime/);
    });
  }
});
