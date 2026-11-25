import 'server-only';
import type { CommercialRegister } from './commercial';

// Contract of CommercialRegister: a lookup by full trade register number, never
// a search; an unknown or malformed number answers nothing. The entries a
// contract run expects are given by the caller (the demo's or the test's).

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`commercial register contract: ${message}`);
}

export interface RegisterFixture {
  readonly known: string;
  readonly knownName: string;
}

export const REGISTER_CONTRACT: readonly { name: string; run: (register: CommercialRegister, fixture: RegisterFixture) => Promise<void> }[] = [
  {
    name: 'describes itself as the replaceable commercial register',
    run: async (register) => {
      await Promise.resolve();
      assert(register.component.id === 'commercial-register', 'component id must be "commercial-register"');
    },
  },
  {
    name: 'answers a full number with the company, whatever its spacing and case',
    run: async (register, fixture) => {
      const entry = await register.lookup(fixture.known);
      assert(entry?.name === fixture.knownName, 'the known number gives its company');
      const spaced = await register.lookup(` ${fixture.known.toLowerCase()} `);
      assert(spaced?.name === fixture.knownName, 'the number is normalized');
    },
  },
  {
    name: 'answers nothing to an unknown number, a prefix or a pattern',
    run: async (register, fixture) => {
      assert((await register.lookup('RC-UNKNOWN-0000')) === null, 'unknown number');
      assert((await register.lookup(fixture.known.slice(0, -1))) === null, 'a prefix is not a search');
      assert((await register.lookup('%')) === null, 'a pattern is not a search');
      assert((await register.lookup('')) === null, 'an empty number');
    },
  },
];
