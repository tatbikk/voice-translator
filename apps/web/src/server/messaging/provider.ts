import 'server-only';
import type { ReplaceableComponent } from '@mahkama/core';

// Internal interface of the messaging service (text messages and e-mail).
// Today: the simulated outbox («صندوق الرسائل الصادرة»). Later: an SMS provider
// and a mail server, behind the same interface, chosen by configuration.
//
// A message is information, never a legal notification: a legal notification
// is deposited in the recipient's account and acknowledged there.

export interface OutboundMessageRequest {
  readonly channel: 'SMS' | 'EMAIL';
  readonly recipientUserId: string | null;
  readonly recipientAddress: string;
  readonly templateKey: string;
  readonly params: Readonly<Record<string, string | number>>;
  /** true when the message carries a code or a link that grants access */
  readonly holdsSecret: boolean;
  /** when the secret it carries stops being valid */
  readonly expiresAt?: Date | null;
  /**
   * For accounts not flagged as demo accounts, the simulated outbox shows the
   * message only to this session (the one that asked for it).
   */
  readonly visibleToSessionId?: string | null;
}

export interface MessagingProvider {
  readonly component: ReplaceableComponent;
  send(message: OutboundMessageRequest): Promise<void>;
}
