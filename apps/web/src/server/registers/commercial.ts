import 'server-only';
import type { ReplaceableComponent } from '@mahkama/core';
import { getDb } from '../db';

// The commercial register (prompt, «السجلات ومنصة البيانات»): one internal
// interface, a small local table of fictitious entries today, every answer
// carrying «مصدر محاكى»; the central trade register tomorrow. It answers a
// lookup by full trade register number only, never a search (memo row 22).

export interface RegisterEntry {
  readonly number: string;
  readonly name: string;
  readonly legalForm: string | null;
  readonly legalRepresentative: string | null;
  readonly registeredOffice: string | null;
  /** the locality code of the registered office (rules/districts.json) */
  readonly locality: string | null;
  readonly branch: string | null;
  readonly email: string | null;
}

export interface CommercialRegister {
  readonly component: ReplaceableComponent;
  lookup(number: string): Promise<RegisterEntry | null>;
}

/** A trade register number as the register keys it. */
export const registerKey = (number: string) => number.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '');

const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value : null);

function simulatedRegister(): CommercialRegister {
  return {
    component: {
      id: 'commercial-register',
      nameKey: 'components.commercialRegister.name',
      descriptionKey: 'components.commercialRegister.description',
      replacementKey: 'components.commercialRegister.replacement',
      implementation: 'simulated',
    },
    async lookup(number) {
      const key = registerKey(number);
      if (!/^[A-Z0-9-]{3,40}$/.test(key)) return null;
      const row = await getDb().simulatedRegistryEntry.findUnique({ where: { registry_key: { registry: 'COMMERCIAL_REGISTER', key } }, select: { key: true, data: true } });
      if (!row) return null;
      const data = (row.data ?? {}) as Record<string, unknown>;
      const name = text(data.name);
      if (!name) return null;
      return {
        number: row.key,
        name,
        legalForm: text(data.legalForm),
        legalRepresentative: text(data.legalRepresentative),
        registeredOffice: text(data.registeredOffice),
        locality: text(data.locality),
        branch: text(data.branch),
        email: text(data.email),
      };
    },
  };
}

let current: CommercialRegister | null = null;

export function commercialRegister(): CommercialRegister {
  current ??= simulatedRegister();
  return current;
}

export function setCommercialRegisterForTests(next: CommercialRegister | null): void {
  current = next;
}
