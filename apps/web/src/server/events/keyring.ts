import 'server-only';
import { masterKey } from '../keys';

// Keys of the event chain. They derive from SECRETS_MASTER_KEY and never enter
// the database. A future rotation adds a version here (procedure: Phase 9).
export const CURRENT_CHAIN_KEY_VERSION = 1;

export function chainKey(version: number): Buffer {
  if (version !== 1) throw new Error('unknown event-chain key version');
  return masterKey('event-chain-v1');
}

export function chainKeyring(version: number): Buffer | undefined {
  return version === 1 ? masterKey('event-chain-v1') : undefined;
}
