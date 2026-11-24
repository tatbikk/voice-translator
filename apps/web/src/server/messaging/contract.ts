import 'server-only';
import type { MessagingProvider } from './provider';

// Contract every implementation of MessagingProvider must pass (simulated today,
// real tomorrow): the same checks, run by tests/integration/contracts.test.ts
// against every implementation. A real provider replaces the simulated one only
// once it passes them.

export interface ContractCheck<P> {
  readonly name: string;
  readonly run: (provider: P) => Promise<void>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`messaging contract: ${message}`);
}

async function rejects(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return false;
  } catch {
    return true;
  }
}

// Fictitious, non-routable addresses, like every address of the demo data.
const PROBE_PHONE = '+000 0000 0000';
const PROBE_EMAIL = 'probe@demo.mahkama.example';

export const MESSAGING_CONTRACT: readonly ContractCheck<MessagingProvider>[] = [
  {
    name: 'describes itself as a replaceable component',
    run: async (provider) => {
      await Promise.resolve();
      assert(provider.component.id === 'messaging', 'component id must be "messaging"');
      assert(['simulated', 'real', 'test'].includes(provider.component.implementation), 'implementation kind');
    },
  },
  {
    name: 'accepts a text message and an e-mail',
    run: async (provider) => {
      await provider.send({
        channel: 'SMS',
        recipientUserId: null,
        recipientAddress: PROBE_PHONE,
        templateKey: 'messages.sms.contractProbe',
        params: {},
        holdsSecret: false,
      });
      await provider.send({
        channel: 'EMAIL',
        recipientUserId: null,
        recipientAddress: PROBE_EMAIL,
        templateKey: 'messages.email.contractProbe',
        params: {},
        holdsSecret: false,
      });
    },
  },
  {
    name: 'accepts a message carrying a secret with its expiry',
    run: async (provider) => {
      await provider.send({
        channel: 'SMS',
        recipientUserId: null,
        recipientAddress: PROBE_PHONE,
        templateKey: 'messages.sms.secondFactorCode',
        params: { code: '000000' },
        holdsSecret: true,
        expiresAt: new Date(Date.UTC(2100, 0, 1)),
      });
    },
  },
  {
    name: 'refuses a message carrying a secret without an expiry',
    run: async (provider) => {
      const refused = await rejects(() =>
        provider.send({
          channel: 'SMS',
          recipientUserId: null,
          recipientAddress: PROBE_PHONE,
          templateKey: 'messages.sms.secondFactorCode',
          params: { code: '000000' },
          holdsSecret: true,
        }),
      );
      assert(refused, 'a secret without an expiry must be refused');
    },
  },
  {
    name: 'refuses an unknown template and a template with a missing parameter',
    run: async (provider) => {
      const unknown = await rejects(() =>
        provider.send({
          channel: 'EMAIL',
          recipientUserId: null,
          recipientAddress: PROBE_EMAIL,
          templateKey: 'messages.email.noSuchTemplate',
          params: {},
          holdsSecret: false,
        }),
      );
      assert(unknown, 'an unknown template must be refused');
      const incomplete = await rejects(() =>
        provider.send({
          channel: 'SMS',
          recipientUserId: null,
          recipientAddress: PROBE_PHONE,
          templateKey: 'messages.sms.secondFactorCode',
          params: {},
          holdsSecret: true,
          expiresAt: new Date(Date.UTC(2100, 0, 1)),
        }),
      );
      assert(incomplete, 'a template whose parameters are missing must be refused');
    },
  },
];
