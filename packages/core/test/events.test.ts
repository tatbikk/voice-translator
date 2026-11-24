import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, EventValidationError, isEventAction, validateEventDetails, type EventAction } from '../src/index';

const HASH = 'a'.repeat(64);
const UUID = '11111111-1111-4111-8111-111111111111';

describe('event catalogue', () => {
  it('is closed: unknown actions are refused', () => {
    expect(isEventAction('auth.logout')).toBe(true);
    expect(isEventAction('auth.anything')).toBe(false);
    expect(isEventAction('__proto__')).toBe(false);
    expect(() => validateEventDetails('auth.anything' as EventAction, {})).toThrow(EventValidationError);
  });

  it('accepts well-formed details', () => {
    expect(validateEventDetails('auth.login.failed', { identifierHash: HASH, reason: 'INVALID_CREDENTIALS' })).toEqual({
      identifierHash: HASH,
      reason: 'INVALID_CREDENTIALS',
    });
    expect(
      validateEventDetails('admin.account.created', {
        newUserId: UUID,
        role: 'LAWYER',
        courtId: null,
        requestReferenceHash: HASH,
      }),
    ).toBeDefined();
  });

  it('refuses unknown keys in every event type', () => {
    for (const action of Object.keys(EVENT_TYPES) as EventAction[]) {
      expect(() => validateEventDetails(action, { unexpected: 'x' })).toThrow(EventValidationError);
    }
  });

  it('refuses free text, e-mail addresses and secrets where identifiers are expected', () => {
    // A user typing a password into the e-mail field must never reach the log.
    expect(() =>
      validateEventDetails('auth.login.failed', { identifierHash: 'MyS3cret password', reason: 'INVALID_CREDENTIALS' }),
    ).toThrow();
    expect(() => validateEventDetails('auth.login.blocked', { identifierHash: 'someone@example.com', bucket: 'default' })).toThrow();
    expect(() =>
      validateEventDetails('access.denied', { step: 'AUTHZ', reason: 'free text with spaces', target: 'x' }),
    ).toThrow();
    expect(() => validateEventDetails('demo.outbox.viewed', { count: 1.5 })).toThrow();
  });

  it('declares one outcome per event type', () => {
    for (const definition of Object.values(EVENT_TYPES)) {
      expect(['DONE', 'DENIED', 'FAILED']).toContain(definition.outcome);
    }
  });
});
