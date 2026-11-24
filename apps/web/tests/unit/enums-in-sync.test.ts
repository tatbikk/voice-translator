// Review A-16: the procedural states are defined in the core, with their
// machine; the database enum must hold exactly the same values.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CASE_KINDS, CASE_STATUSES, PARTY_SIDES } from '@mahkama/core';

const schema = readFileSync(fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)), 'utf8');

function prismaEnum(name: string): string[] {
  const block = new RegExp(`^enum ${name} \\{([^}]*)\\}`, 'm').exec(schema);
  if (!block?.[1]) throw new Error(`enum ${name} not found in the schema`);
  return block[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => /^[A-Z_]+$/.test(line));
}

describe('the database enums follow the core (review A-16)', () => {
  it.each([
    ['CaseStatus', CASE_STATUSES],
    ['CaseKind', CASE_KINDS],
    ['PartySide', PARTY_SIDES],
  ] as const)('%s', (name, values) => {
    expect(prismaEnum(name)).toEqual([...values]);
  });
});
