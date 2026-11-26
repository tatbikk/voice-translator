// Review of IR-43 (P2-A-12): `prisma migrate deploy` applies every pending
// migration after those already applied, whatever its name. A migration named
// before the last one applied would run last on a database that holds the
// others, and in its place on a fresh one. The release refuses it before it
// migrates (decision 83); it reports, without refusing, an applied migration
// whose text is no longer the one applied (IR-43, remainder).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { guardMigrations, migrationsOnDisk } from '@/cli/migration-guard';
import { WEB_ROOT } from '../helpers/env';

const sha = (c: string) => c.repeat(64);
const onDisk = [
  { name: '20261126140000_party_address_place', sha256: sha('a') },
  { name: '20261126150000_document_depositor_and_court', sha256: sha('b') },
  { name: '20261126160000_list_scope_facts', sha256: sha('c') },
];
const applied = (names: readonly string[]) => onDisk.filter((m) => names.includes(m.name)).map((m) => ({ name: m.name, checksum: m.sha256 }));

describe('the migration guard of the release (review of IR-43, P2-A-12)', () => {
  it('lets a fresh database, an up-to-date one, and one behind by the last migrations migrate', () => {
    for (const names of [[], onDisk.map((m) => m.name), [onDisk[0]!.name]]) {
      expect(guardMigrations(onDisk, applied(names)), names.join(',')).toEqual({ datedBeforeApplied: [], changedAfterApplied: [] });
    }
  });

  it('refuses a pending migration dated before the last one applied', () => {
    const probe = { name: '20261126155900_probe_earlier', sha256: sha('d') };
    const disk = [...onDisk, probe].sort((x, y) => (x.name < y.name ? -1 : 1));
    expect(guardMigrations(disk, applied(onDisk.map((m) => m.name)))).toEqual({
      datedBeforeApplied: [{ migration: probe.name, lastApplied: '20261126160000_list_scope_facts' }],
      changedAfterApplied: [],
    });
    // The same migration dated after the last one applied is the ordinary case.
    const later = { name: '20261126170000_probe_later', sha256: sha('e') };
    expect(guardMigrations([...onDisk, later], applied(onDisk.map((m) => m.name))).datedBeforeApplied).toEqual([]);
  });

  it('refuses it even when the database is behind: what counts is the last one applied, not the last one on disk', () => {
    const probe = { name: '20261126135900_probe_earliest', sha256: sha('f') };
    expect(guardMigrations([probe, ...onDisk], applied([onDisk[1]!.name, onDisk[0]!.name])).datedBeforeApplied).toEqual([
      { migration: probe.name, lastApplied: '20261126150000_document_depositor_and_court' },
    ]);
  });

  it('reports an applied migration whose text changed, without refusing for it', () => {
    const edited = [onDisk[0]!, { ...onDisk[1]!, sha256: sha('9') }, onDisk[2]!];
    expect(guardMigrations(edited, applied(onDisk.map((m) => m.name)))).toEqual({
      datedBeforeApplied: [],
      changedAfterApplied: ['20261126150000_document_depositor_and_court'],
    });
  });

  it('reads the migrations of prisma/migrations with the SHA-256 the list holds', () => {
    const history = JSON.parse(readFileSync(join(WEB_ROOT, 'prisma', 'migration-history.json'), 'utf8')) as { migrations: { name: string; sha256: string }[] };
    expect(migrationsOnDisk(join(WEB_ROOT, 'prisma', 'migrations'))).toEqual(history.migrations);
  });
});
