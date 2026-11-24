import 'server-only';
import type { MessagingProvider } from './provider';

// Contract every implementation of MessagingProvider must pass (simulated today,
// real tomorrow). Plain async checks, run by the integration tests.

export interface ContractCheck<P> {
  readonly name: string;
  readonly run: (provider: P) => Promise<void>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`messaging contract: ${message}`);
}

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
    name: 'accepts a text message and an e-mail without throwing',
    run: async (provider) => {
      await provider.send({
        channel: 'SMS',
        recipientUserId: null,
        recipientAddress: '+212600000000',
        templateKey: 'messages.sms.contractProbe',
        params: {},
        holdsSecret: false,
      });
      await provider.send({
        channel: 'EMAIL',
        recipientUserId: null,
        recipientAddress: 'probe@demo.mahkama.example',
        templateKey: 'messages.email.contractProbe',
        params: {},
        holdsSecret: false,
      });
    },
  },
];
