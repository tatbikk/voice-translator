import 'server-only';
import type { MessagingProvider } from './provider';
import { createSimulatedOutbox } from './simulated-outbox';

// The implementation is chosen here, by configuration, never in callers.
// Phase 0 has only the simulated outbox; the real provider is listed in
// docs/production-readiness.md.
let provider: MessagingProvider | null = null;

export function messaging(): MessagingProvider {
  provider ??= createSimulatedOutbox();
  return provider;
}

/** Tests swap the provider through this function only. */
export function setMessagingProviderForTests(next: MessagingProvider | null): void {
  provider = next;
}

export type { MessagingProvider, OutboundMessageRequest } from './provider';
