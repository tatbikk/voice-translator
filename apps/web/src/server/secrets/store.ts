import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { clock } from '../clock';
import { getDb } from '../db';
import { masterKey } from '../keys';

// Encrypted settings (provider keys from Phase 8): AES-256-GCM with a key
// derived from SECRETS_MASTER_KEY, a random 12-byte IV per write, and the
// setting's name as additional authenticated data (a ciphertext moved to
// another name does not decrypt). Once stored, a value is never shown again:
// describe() returns its label and last four characters only.

const KEY_VERSION = 1;

function key(version: number): Buffer {
  if (version !== KEY_VERSION) throw new Error('unknown secret-store key version');
  return masterKey('secret-store-v1');
}

export interface SecretDescription {
  readonly name: string;
  readonly last4: string;
  readonly updatedAt: Date;
}

export async function putSecret(name: string, value: string, updatedByUserId: string | null): Promise<void> {
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(name)) throw new Error('invalid secret name');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(KEY_VERSION), iv);
  cipher.setAAD(Buffer.from(name, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const last4 = value.slice(-4);
  const data = { ciphertext, iv, tag, last4, keyVersion: KEY_VERSION, updatedAt: clock.now(), updatedByUserId };
  await getDb().secretSetting.upsert({ where: { name }, create: { name, ...data }, update: data });
}

/** Server-internal use only (provider calls). Never serialise the result. */
export async function getSecretForUse(name: string): Promise<string | null> {
  const row = await getDb().secretSetting.findUnique({ where: { name } });
  if (!row) return null;
  const decipher = createDecipheriv('aes-256-gcm', key(row.keyVersion), row.iv);
  decipher.setAAD(Buffer.from(row.name, 'utf8'));
  decipher.setAuthTag(row.tag);
  return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString('utf8');
}

export async function describeSecret(name: string): Promise<SecretDescription | null> {
  const row = await getDb().secretSetting.findUnique({ where: { name }, select: { name: true, last4: true, updatedAt: true } });
  return row;
}
