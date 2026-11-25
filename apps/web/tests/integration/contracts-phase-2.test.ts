// Contract tests of the two components Phase 2 adds behind an internal
// interface (CLAUDE.md): the payment gateway and the commercial register. Each
// contract runs against the implementation in use and against a second,
// independent one written here, so that the checks test the interface.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PAYMENT_CONTRACT } from '@/server/payments/contract';
import { paymentGateway, type PaymentGateway } from '@/server/payments/gateway';
import { REGISTER_CONTRACT } from '@/server/registers/contract';
import { commercialRegister, registerKey, type CommercialRegister } from '@/server/registers/commercial';
import { owner } from '../helpers/db';
import { useFreshDatabase } from '../helpers/reset';

useFreshDatabase();

function countingGateway(): PaymentGateway {
  let n = 0;
  return {
    component: { id: 'payment', nameKey: 'components.payment.name', descriptionKey: 'components.payment.description', replacementKey: 'components.payment.replacement', implementation: 'test' },
    async settle(request) {
      await Promise.resolve();
      if (request.amountCents <= 0n) throw new Error('amount');
      n += 1;
      return { status: request.chosen, operationRef: `TEST-${String(n).padStart(6, '0')}` };
    },
  };
}

function mapRegister(entries: Readonly<Record<string, string>>): CommercialRegister {
  return {
    component: { id: 'commercial-register', nameKey: 'components.commercialRegister.name', descriptionKey: 'components.commercialRegister.description', replacementKey: 'components.commercialRegister.replacement', implementation: 'test' },
    async lookup(number) {
      await Promise.resolve();
      const name = entries[registerKey(number)];
      return name ? { number: registerKey(number), name, legalForm: null, legalRepresentative: null, registeredOffice: null, locality: null, branch: null, email: null } : null;
    },
  };
}

describe('payment gateway contract', () => {
  for (const [name, gateway] of [
    ['platform gateway', () => paymentGateway()],
    ['counting gateway', countingGateway],
  ] as const) {
    for (const check of PAYMENT_CONTRACT) {
      it(`${name}: ${check.name}`, async () => {
        await check.run(gateway());
      });
    }
  }

  it('declares the platform gateway simulated, so production refuses to boot with it', () => {
    expect(paymentGateway().component.implementation).toBe('simulated');
  });
});

describe('commercial register contract', () => {
  const key = `RC-CONTRACT-${randomUUID().slice(0, 8).toUpperCase()}`;
  beforeAll(async () => {
    // The simulated register is written by the owner only (db-roles).
    await owner().query(`INSERT INTO "SimulatedRegistryEntry" (id, registry, key, data) VALUES (gen_random_uuid(), 'COMMERCIAL_REGISTER', $1, $2::jsonb)`, [
      key,
      JSON.stringify({ name: 'شركة العقد النموذجية' }),
    ]);
  });

  for (const [name, register] of [
    ['platform register', () => commercialRegister()],
    ['map register', () => mapRegister({ [key]: 'شركة العقد النموذجية' })],
  ] as const) {
    for (const check of REGISTER_CONTRACT) {
      it(`${name}: ${check.name}`, async () => {
        await check.run(register(), { known: key, knownName: 'شركة العقد النموذجية' });
      });
    }
  }

  it('declares the platform register simulated', () => {
    expect(commercialRegister().component.implementation).toBe('simulated');
  });
});
