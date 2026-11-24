// Contract tests of the replaceable components (CLAUDE.md: «كل مكون يتوقف على جهة
// خارجية يوضع خلف واجهة داخلية لها اختبار عقد»; review A-02). Every check of a
// contract runs against the implementation the platform uses today (the
// simulated outbox and register) and against a second, independent
// implementation, which shows that the checks test the interface and not one
// implementation. A real provider will have to pass the same checks.
import { describe, expect, it } from 'vitest';
import type { ReplaceableComponent } from '@mahkama/core';
import { hasMessage, translate } from '@/i18n/translate';
import { professionalIdentity } from '@/server/identity';
import { IDENTITY_CONTRACT } from '@/server/identity/contract';
import type { ProfessionalIdentityProvider } from '@/server/identity/provider';
import { messaging } from '@/server/messaging';
import { MESSAGING_CONTRACT } from '@/server/messaging/contract';
import type { MessagingProvider, OutboundMessageRequest } from '@/server/messaging/provider';
import { useFreshDatabase } from '../helpers/reset';

const testComponent = (id: string): ReplaceableComponent => ({
  id,
  nameKey: `components.${id}.name`,
  descriptionKey: `components.${id}.description`,
  replacementKey: `components.${id}.replacement`,
  implementation: 'test',
});

/** A second messaging implementation: keeps messages in memory. */
function memoryMessaging(): MessagingProvider & { readonly sent: OutboundMessageRequest[] } {
  const sent: OutboundMessageRequest[] = [];
  return {
    component: testComponent('messaging'),
    sent,
    async send(message) {
      await Promise.resolve();
      if (!hasMessage(message.templateKey)) throw new Error('unknown template');
      if (message.holdsSecret && !message.expiresAt) throw new Error('a secret needs an expiry');
      if (/\{[A-Za-z][A-Za-z0-9_]*\}/.test(translate('ar', message.templateKey, message.params))) throw new Error('missing parameter');
      sent.push(message);
    },
  };
}

/** A second identity implementation: a register that knows nobody. */
function emptyRegister(): ProfessionalIdentityProvider {
  return {
    component: testComponent('professional-identity'),
    async verify() {
      await Promise.resolve();
      return { status: 'UNVERIFIED', source: 'empty-test-register' };
    },
  };
}

describe('messaging contract', () => {
  useFreshDatabase();

  const implementations: [string, () => MessagingProvider][] = [
    ['the simulated outbox (used today)', () => messaging()],
    ['an in-memory implementation', () => memoryMessaging()],
  ];
  for (const [name, make] of implementations) {
    for (const check of MESSAGING_CONTRACT) {
      it(`${name}: ${check.name}`, async () => {
        await expect(check.run(make())).resolves.toBeUndefined();
      });
    }
  }

  it('the simulated outbox is the implementation in use, and declares itself simulated', () => {
    expect(messaging().component.implementation).toBe('simulated');
  });
});

describe('professional identity contract', () => {
  useFreshDatabase();

  const implementations: [string, () => ProfessionalIdentityProvider][] = [
    ['the simulated register (used today)', () => professionalIdentity()],
    ['an empty register', () => emptyRegister()],
  ];
  for (const [name, make] of implementations) {
    for (const check of IDENTITY_CONTRACT) {
      it(`${name}: ${check.name}`, async () => {
        await expect(check.run(make())).resolves.toBeUndefined();
      });
    }
  }

  it('the simulated register is the implementation in use, and declares itself simulated', () => {
    expect(professionalIdentity().component.implementation).toBe('simulated');
  });
});
