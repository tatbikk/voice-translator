import 'server-only';
import type { ReplaceableComponent } from '@mahkama/core';
import { hasMessage, translate } from '@/i18n/translate';
import { clock } from '../clock';
import { getDb } from '../db';
import type { MessagingProvider, OutboundMessageRequest } from './provider';

export const SIMULATED_MESSAGING_COMPONENT: ReplaceableComponent = {
  id: 'messaging',
  nameKey: 'components.messaging.name',
  descriptionKey: 'components.messaging.description',
  replacementKey: 'components.messaging.replacement',
  implementation: 'simulated',
};

/** Nothing leaves the platform: every message is written to the outbox. */
export function createSimulatedOutbox(): MessagingProvider {
  return {
    component: SIMULATED_MESSAGING_COMPONENT,
    async send(message: OutboundMessageRequest): Promise<void> {
      // The messaging contract: a known template, every parameter given, an expiry for a secret.
      if (!hasMessage(message.templateKey)) throw new Error('messaging: unknown template');
      if (message.holdsSecret && !message.expiresAt) throw new Error('messaging: a secret needs an expiry');
      const body = translate('ar', message.templateKey, message.params);
      if (/\{[A-Za-z][A-Za-z0-9_]*\}/.test(body)) throw new Error('messaging: missing template parameter');
      const sender = translate('ar', message.channel === 'SMS' ? 'messages.sender.sms' : 'messages.sender.email');
      await getDb().outboundMessage.create({
        data: {
          channel: message.channel,
          sender,
          recipientUserId: message.recipientUserId,
          recipientAddress: message.recipientAddress,
          templateKey: message.templateKey,
          body,
          holdsSecret: message.holdsSecret,
          expiresAt: message.expiresAt ?? null,
          visibleToSessionId: message.visibleToSessionId ?? null,
          createdAt: clock.now(),
        },
      });
    },
  };
}
