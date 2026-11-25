import 'server-only';
import type { PaymentGateway, SettleRequest } from './gateway';

// Contract of PaymentGateway: what the simulated gateway does today and an
// approved payment provider must do tomorrow. The amount is the platform's; the
// gateway reports the outcome and gives a reference unique to the operation.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`payment contract: ${message}`);
}

const AT = new Date(Date.UTC(2027, 2, 15, 9, 30));
const request = (chosen: SettleRequest['chosen'], amountCents = 557_000n): SettleRequest => ({ intentId: '0f0e0d0c-0b0a-4908-8706-050403020100', amountCents, chosen, at: AT });

export const PAYMENT_CONTRACT: readonly { name: string; run: (gateway: PaymentGateway) => Promise<void> }[] = [
  {
    name: 'describes itself as the replaceable payment component',
    run: async (gateway) => {
      await Promise.resolve();
      assert(gateway.component.id === 'payment', 'component id must be "payment"');
      assert(['simulated', 'real', 'test'].includes(gateway.component.implementation), 'implementation kind');
    },
  },
  {
    name: 'reports each outcome with a reference, distinct for every operation',
    run: async (gateway) => {
      const refs = new Set<string>();
      for (const chosen of ['SUCCEEDED', 'FAILED', 'CANCELLED'] as const) {
        const result = await gateway.settle(request(chosen));
        assert(result.status === chosen, `the outcome ${chosen} is reported as is`);
        assert(/^[A-Z0-9-]{8,64}$/.test(result.operationRef), 'a reference of letters, digits and dashes');
        refs.add(result.operationRef);
      }
      const again = await gateway.settle(request('SUCCEEDED'));
      refs.add(again.operationRef);
      assert(refs.size === 4, 'no two operations share a reference');
    },
  },
  {
    name: 'refuses an amount that is not positive',
    run: async (gateway) => {
      let refused = false;
      try {
        await gateway.settle(request('SUCCEEDED', 0n));
      } catch {
        refused = true;
      }
      assert(refused, 'a zero amount is refused');
    },
  },
];
