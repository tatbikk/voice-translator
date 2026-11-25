import 'server-only';
import { randomBytes } from 'node:crypto';
import { moroccoDay, type ReplaceableComponent } from '@mahkama/core';

// The payment gateway (prompt, «الأداء»): one internal interface, a simulated
// gateway today («أداء (محاكاة)», three buttons), an approved payment provider
// under the regulatory text of art. 628 tomorrow. The amount is the platform's,
// computed from the claims; the gateway only reports the outcome and gives the
// operation reference. The boot check refuses the production mode while it is
// simulated.

export type GatewayOutcome = 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface SettleRequest {
  readonly intentId: string;
  readonly amountCents: bigint;
  /** what the payer chose on the simulated page */
  readonly chosen: GatewayOutcome;
  readonly at: Date;
}

export interface SettleResult {
  readonly status: GatewayOutcome;
  /** unique reference of the operation, also for a failure or a cancellation */
  readonly operationRef: string;
}

export interface PaymentGateway {
  readonly component: ReplaceableComponent;
  settle(request: SettleRequest): Promise<SettleResult>;
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
function reference(prefix: string, at: Date): string {
  const bytes = randomBytes(10);
  const tail = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${prefix}-${moroccoDay(at).replaceAll('-', '')}-${tail}`;
}

function simulatedGateway(): PaymentGateway {
  return {
    component: {
      id: 'payment',
      nameKey: 'components.payment.name',
      descriptionKey: 'components.payment.description',
      replacementKey: 'components.payment.replacement',
      implementation: 'simulated',
    },
    settle(request) {
      if (request.amountCents <= 0n) return Promise.reject(new Error('payment amount must be positive'));
      const prefix = request.chosen === 'SUCCEEDED' ? 'SIM-PAY' : request.chosen === 'FAILED' ? 'SIM-FAIL' : 'SIM-CANCEL';
      return Promise.resolve({ status: request.chosen, operationRef: reference(prefix, request.at) });
    },
  };
}

let current: PaymentGateway | null = null;

export function paymentGateway(): PaymentGateway {
  current ??= simulatedGateway();
  return current;
}

/** Tests only: another implementation behind the same interface (contract test). */
export function setPaymentGatewayForTests(next: PaymentGateway | null): void {
  current = next;
}
